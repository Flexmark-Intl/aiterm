use std::path::PathBuf;

/// One macOS crash report ("ips" or "crash" file) summarized for diagnostics.
/// Keep the on-the-wire payload small — just the headers, not the full backtrace.
#[derive(serde::Serialize)]
pub struct CrashReportSummary {
    /// File name (e.g. "aiTerm-2026-05-12-104233.ips") — encodes process and timestamp.
    pub file_name: String,
    /// Absolute path so the user can `open` it.
    pub path: String,
    /// File mtime in seconds since epoch — sortable, comparable to memory_trend timestamps.
    pub mtime_secs: u64,
    /// Bucket: "host" (aiTerm-* or aiterm-*) or "webcontent" (WebKit renderer process).
    pub category: &'static str,
    /// Process name parsed from the report header (.ips first-line JSON or .crash "Process:" line).
    pub process: Option<String>,
    /// App version from the report.
    pub app_version: Option<String>,
    /// Exception type (e.g. "EXC_CRASH (SIGABRT)" / "EXC_BAD_ACCESS").
    pub exception_type: Option<String>,
    /// Termination reason if present (often the most diagnostic single line).
    pub termination_reason: Option<String>,
}

/// Scan ~/Library/Logs/DiagnosticReports/ (and Retired/) for crash reports
/// relevant to maiTerm. Returns at most `max_results` newest reports, looking
/// back at most `max_age_days` days. Designed to surface the immediate
/// post-mortem signal without overwhelming the diagnostics payload.
///
/// Filters: filename must start with "maiTerm", "maiterm", "aiTerm", "aiterm", or
/// "com.apple.WebKit.WebContent" (WebKit renderer crashes — could be ours,
/// could be another Tauri app on this machine, so caller should treat them
/// as candidates not certainties).
///
/// Note: macOS may require Full Disk Access to read DiagnosticReports/.
/// On permission failure we silently return an empty list — the caller
/// distinguishes "no crashes" from "couldn't read" via the directory check
/// in `check_full_disk_access` already wired into the UI.
#[cfg(target_os = "macos")]
pub fn scan_crash_reports(max_results: usize, max_age_days: u64) -> Vec<CrashReportSummary> {
    let Some(home) = dirs::home_dir() else { return Vec::new() };
    let base = home.join("Library/Logs/DiagnosticReports");
    let dirs = [base.clone(), base.join("Retired")];

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let cutoff = now.saturating_sub(max_age_days * 86_400);

    let mut hits: Vec<CrashReportSummary> = Vec::new();
    for dir in &dirs {
        let Ok(entries) = std::fs::read_dir(dir) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let category = if name.starts_with("maiTerm") || name.starts_with("maiterm")
                || name.starts_with("aiTerm") || name.starts_with("aiterm") {
                "host"
            } else if name.starts_with("com.apple.WebKit.WebContent") {
                "webcontent"
            } else {
                continue;
            };
            // Restrict to crash-report formats — skip diag/spin/hang reports
            // for now. .ips covers modern macOS; .crash for older.
            if !(name.ends_with(".ips") || name.ends_with(".crash")) {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            let Some(mtime_secs) = meta.modified().ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs()) else { continue };
            if mtime_secs < cutoff { continue }

            let path = entry.path();
            let (process, app_version, exception_type, termination_reason) =
                parse_crash_headers(&path);
            hits.push(CrashReportSummary {
                file_name: name,
                path: path.to_string_lossy().into_owned(),
                mtime_secs,
                category,
                process,
                app_version,
                exception_type,
                termination_reason,
            });
        }
    }

    // Newest first, then truncate.
    hits.sort_by(|a, b| b.mtime_secs.cmp(&a.mtime_secs));
    hits.truncate(max_results);
    hits
}

#[cfg(not(target_os = "macos"))]
pub fn scan_crash_reports(_max_results: usize, _max_age_days: u64) -> Vec<CrashReportSummary> {
    Vec::new()
}

/// Best-effort header extraction for both .ips (modern, header-line JSON +
/// body JSON) and .crash (older, key:value text) formats. Reads only the
/// first ~16 KB so we never load a full minidump into memory.
#[cfg(target_os = "macos")]
fn parse_crash_headers(path: &std::path::Path)
    -> (Option<String>, Option<String>, Option<String>, Option<String>)
{
    use std::io::Read;
    let Ok(mut f) = std::fs::File::open(path) else { return (None, None, None, None) };
    let mut buf = vec![0u8; 16 * 1024];
    let n = f.read(&mut buf).unwrap_or(0);
    buf.truncate(n);
    let text = String::from_utf8_lossy(&buf);

    let is_ips = path.extension().map(|e| e == "ips").unwrap_or(false);
    if is_ips {
        // .ips: line 1 is JSON metadata, remainder is JSON body. Don't try to
        // fully parse the body (it can be megabytes); just regex/grep for the
        // fields we want.
        let mut process = None;
        let mut app_version = None;
        if let Some(first_line) = text.lines().next() {
            if let Ok(meta) = serde_json::from_str::<serde_json::Value>(first_line) {
                process = meta.get("app_name").and_then(|v| v.as_str()).map(String::from)
                    .or_else(|| meta.get("name").and_then(|v| v.as_str()).map(String::from));
                app_version = meta.get("app_version").and_then(|v| v.as_str()).map(String::from)
                    .or_else(|| meta.get("bundleVersion").and_then(|v| v.as_str()).map(String::from));
            }
        }
        let exception_type = extract_json_string(&text, "\"exception\"")
            .and_then(|exc| extract_json_string(&exc, "\"type\""))
            .or_else(|| extract_json_string(&text, "\"type\""));
        let termination_reason = extract_json_string(&text, "\"termination\"")
            .and_then(|term| extract_json_string(&term, "\"reason\""))
            .or_else(|| extract_json_string(&text, "\"reason\""));
        (process, app_version, exception_type, termination_reason)
    } else {
        // .crash: line-oriented key/value headers.
        let mut process = None;
        let mut app_version = None;
        let mut exception_type = None;
        let mut termination_reason = None;
        for line in text.lines() {
            if let Some(rest) = line.strip_prefix("Process:") {
                process = Some(rest.trim().to_string());
            } else if let Some(rest) = line.strip_prefix("Version:") {
                app_version = Some(rest.trim().to_string());
            } else if let Some(rest) = line.strip_prefix("Exception Type:") {
                exception_type = Some(rest.trim().to_string());
            } else if let Some(rest) = line.strip_prefix("Termination Reason:") {
                termination_reason = Some(rest.trim().to_string());
            }
        }
        (process, app_version, exception_type, termination_reason)
    }
}

/// Find the value of the first occurrence of `"key": "value"` in a JSON-ish
/// text blob. Naive but adequate for crash-report header extraction — we
/// don't need full JSON parsing and the body is too large to deserialize.
#[cfg(target_os = "macos")]
fn extract_json_string(haystack: &str, key_with_quotes: &str) -> Option<String> {
    let key_pos = haystack.find(key_with_quotes)?;
    let after_key = &haystack[key_pos + key_with_quotes.len()..];
    // Skip whitespace and the colon.
    let colon = after_key.find(':')?;
    let after_colon = &after_key[colon + 1..];
    let trimmed = after_colon.trim_start();
    if !trimmed.starts_with('"') { return None }
    let body = &trimmed[1..];
    // Find the closing quote, handling escaped quotes.
    let mut end = 0usize;
    let bytes = body.as_bytes();
    while end < bytes.len() {
        if bytes[end] == b'\\' && end + 1 < bytes.len() { end += 2; continue }
        if bytes[end] == b'"' { break }
        end += 1;
    }
    if end >= bytes.len() { return None }
    Some(body[..end].to_string())
}

#[tauri::command]
pub fn check_full_disk_access() -> bool {
    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
        let probe = home.join("Library/Application Support/com.apple.TCC");
        std::fs::read_dir(&probe).is_ok()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

#[tauri::command]
pub fn open_full_disk_access_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}
