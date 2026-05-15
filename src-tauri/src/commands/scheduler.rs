//! Background tasks owned by the Rust runtime, independent of any webview.
//!
//! These exist because frontend setIntervals are tied to a specific webview's
//! event loop — if that webview hangs, the timer stops firing and we lose
//! whatever periodic work it was doing. Both schedulers below are things we
//! need to keep running even if every window is unresponsive.
//!
//! - `backup_scheduler`: hourly/daily/etc. state backups + retention trim
//! - `memory_sampler`: per-minute RSS samples for crash post-mortem

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

use crate::state::app_state::{MemorySample, MEMORY_SAMPLE_CAP};
use crate::state::persistence::{save_memory_trend, touch_running_marker};
use crate::state::AppState;

/// How often the backup scheduler wakes to check whether a backup is due.
/// Bounded above by acceptable post-wake latency (we want backups to fire
/// reasonably soon after laptop wake, not an hour later).
const BACKUP_CHECK_INTERVAL: Duration = Duration::from_secs(60);

/// How often we sample RSS for the trend ring buffer.
const MEMORY_SAMPLE_INTERVAL: Duration = Duration::from_secs(60);

/// Convert a backup_interval pref string to seconds. Returns None if disabled
/// or unrecognized — caller should skip in that case.
fn interval_secs(interval: &str) -> Option<u64> {
    match interval {
        "hourly" => Some(3600),
        "daily" => Some(86_400),
        "weekly" => Some(7 * 86_400),
        "monthly" => Some(30 * 86_400),
        _ => None,
    }
}

/// Find the most recent aiterm_backup_* file mtime in the backup directory.
/// Returns None if the directory doesn't exist or contains no backups.
fn newest_backup_age_secs(dir: &str) -> Option<u64> {
    let dir_path = PathBuf::from(dir);
    let entries = std::fs::read_dir(&dir_path).ok()?;

    let now = SystemTime::now();
    let mut newest_age: Option<u64> = None;

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("aiterm_backup_") {
            continue;
        }
        if !name.ends_with(".json") && !name.ends_with(".json.gz") {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let Ok(modified) = meta.modified() else { continue };
        let Ok(age) = now.duration_since(modified) else { continue };
        let age_s = age.as_secs();
        newest_age = Some(newest_age.map_or(age_s, |existing| existing.min(age_s)));
    }

    newest_age
}

/// Snapshot of backup-relevant prefs, taken under a brief read lock so the
/// scheduler doesn't hold any locks across the actual backup work.
struct BackupPrefs {
    directory: Option<String>,
    interval: String,
    trim_enabled: bool,
}

fn snapshot_backup_prefs(state: &AppState) -> BackupPrefs {
    let app_data = state.app_data.read();
    let prefs = &app_data.preferences;
    BackupPrefs {
        directory: prefs.backup_directory.clone(),
        interval: prefs.backup_interval.clone(),
        trim_enabled: prefs.backup_trim_enabled,
    }
}

/// Spawn the backup scheduler. Wakes every BACKUP_CHECK_INTERVAL, snapshots
/// prefs, and fires a backup if the newest backup file in the configured
/// directory is older than the configured interval.
///
/// Source-of-truth for "when did we last back up?" is the filesystem mtime
/// of the most recent backup file. This means restarts and laptop sleep are
/// handled naturally — no extra bookkeeping in AppState required.
pub fn spawn_backup_scheduler(state: Arc<AppState>) {
    tauri::async_runtime::spawn(async move {
        log::info!("Backup scheduler started (check interval: {:?})", BACKUP_CHECK_INTERVAL);
        let mut ticker = tokio::time::interval(BACKUP_CHECK_INTERVAL);
        // First tick fires immediately; we want to skip it so we don't backup
        // at every cold start.
        ticker.tick().await;
        loop {
            ticker.tick().await;

            let prefs = snapshot_backup_prefs(&state);
            let Some(dir) = prefs.directory else { continue };
            let Some(target_secs) = interval_secs(&prefs.interval) else { continue };

            // Compute "is a backup due?" Either no prior backup, or the
            // newest one is older than the target interval. Allow a small
            // jitter window (target - 5s) so we don't drift past the hour
            // mark waiting for the next 60s tick.
            let due = match newest_backup_age_secs(&dir) {
                None => true,
                Some(age) => age + 5 >= target_secs,
            };
            if !due {
                continue;
            }

            match crate::commands::workspace::do_scheduled_backup(&state) {
                Ok(_path) => {
                    if prefs.trim_enabled {
                        match crate::commands::workspace::do_trim_old_backups(&state) {
                            Ok(_) => {}
                            Err(e) => log::warn!("Scheduled backup trim failed: {}", e),
                        }
                    }
                }
                Err(e) => log::warn!("Scheduled backup failed: {}", e),
            }
        }
    });
}

/// Spawn the memory sampler. Wakes every MEMORY_SAMPLE_INTERVAL, samples our
/// own RSS via sysinfo, appends to the in-memory ring buffer, and persists
/// the buffer to disk. The on-disk file survives restarts so post-mortem
/// analysis after a crash can see RSS history leading up to the freeze.
pub fn spawn_memory_sampler(state: Arc<AppState>) {
    tauri::async_runtime::spawn(async move {
        log::info!("Memory sampler started (interval: {:?}, cap: {})", MEMORY_SAMPLE_INTERVAL, MEMORY_SAMPLE_CAP);
        let pid = Pid::from_u32(std::process::id());
        let mut sys = System::new();
        let refresh = ProcessRefreshKind::nothing().with_memory();

        let mut ticker = tokio::time::interval(MEMORY_SAMPLE_INTERVAL);
        loop {
            ticker.tick().await;

            sys.refresh_processes_specifics(ProcessesToUpdate::Some(&[pid]), true, refresh);
            let rss = sys.process(pid).map(|p| p.memory()).unwrap_or(0);
            let timestamp_secs = SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);

            let snapshot: Vec<MemorySample> = {
                let mut samples = state.memory_samples.write();
                samples.push(MemorySample { timestamp_secs, rss_bytes: rss });
                if samples.len() > MEMORY_SAMPLE_CAP {
                    let drain = samples.len() - MEMORY_SAMPLE_CAP;
                    samples.drain(..drain);
                }
                samples.clone()
            };

            save_memory_trend(&snapshot);
            // Bump the running-marker mtime each tick so its timestamp is a
            // tight upper bound on time-of-crash if this process dies.
            touch_running_marker();
        }
    });
}
