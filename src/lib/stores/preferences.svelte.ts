import type { CursorStyle, Preferences, Trigger } from '$lib/tauri/types';
import type { Theme } from '$lib/themes';
import { builtinThemes } from '$lib/themes';
import * as commands from '$lib/tauri/commands';

function createPreferencesStore() {
  let _resolveReady: () => void;
  const ready = new Promise<void>(r => { _resolveReady = r; });

  let fontSize = $state(13);
  let fontFamily = $state('Menlo');
  let cursorStyle = $state<CursorStyle>('block');
  let cursorBlink = $state(true);
  let autoSaveInterval = $state(10);
  let scrollbackLimit = $state(10000);
  let promptPatterns = $state<string[]>([]);
  let cloneCwd = $state(true);
  let cloneScrollback = $state(true);
  let cloneSsh = $state(true);
  let cloneHistory = $state(true);
  let cloneNotes = $state(true);
  let cloneAutoResume = $state(true);
  let cloneVariables = $state(true);
  let theme = $state('tokyo-night');
  let shellTitleIntegration = $state(false);
  let shellIntegration = $state(false);
  let customThemes = $state<Theme[]>([]);
  let restoreSession = $state(false);
  let notificationMode = $state('auto');
  let notifyMinDuration = $state(30);
  let notesFontSize = $state(16);
  let notesFontFamily = $state('Menlo');
  let notesWidth = $state(320);
  let notesWordWrap = $state(true);
  let toastFontSize = $state(14);
  let toastWidth = $state(400);
  let toastDuration = $state(8);
  let notificationSound = $state('default');
  let notificationVolume = $state(50);
  let migrateTabNotes = $state(true);
  let notesScope = $state<'tab' | 'workspace'>('tab');
  let showRecentWorkspaces = $state(true);
  let workspaceSortOrder = $state('default');
  let showWorkspaceTabCount = $state(false);
  let triggers = $state<Trigger[]>([]);
  let hiddenDefaultTriggers = $state<string[]>([]);
  let claudeTriggersPrompted = $state(false);
  let claudeCodeIde = $state(false);
  let windowsShell = $state('powershell');

  return {
    /** Resolves once the initial load() has completed. */
    get ready() { return ready; },
    get fontSize() { return fontSize; },
    get fontFamily() { return fontFamily; },
    get cursorStyle() { return cursorStyle; },
    get cursorBlink() { return cursorBlink; },
    get autoSaveInterval() { return autoSaveInterval; },
    get scrollbackLimit() { return scrollbackLimit; },
    get promptPatterns() { return promptPatterns; },
    get cloneCwd() { return cloneCwd; },
    get cloneScrollback() { return cloneScrollback; },
    get cloneSsh() { return cloneSsh; },
    get cloneHistory() { return cloneHistory; },
    get cloneNotes() { return cloneNotes; },
    get cloneAutoResume() { return cloneAutoResume; },
    get cloneVariables() { return cloneVariables; },
    get theme() { return theme; },
    get shellTitleIntegration() { return shellTitleIntegration; },
    get shellIntegration() { return shellIntegration; },
    get customThemes() { return customThemes; },
    get restoreSession() { return restoreSession; },
    get notificationMode() { return notificationMode; },
    get notifyMinDuration() { return notifyMinDuration; },
    get notesFontSize() { return notesFontSize; },
    get notesFontFamily() { return notesFontFamily; },
    get notesWidth() { return notesWidth; },
    get notesWordWrap() { return notesWordWrap; },
    get toastFontSize() { return toastFontSize; },
    get toastWidth() { return toastWidth; },
    get toastDuration() { return toastDuration; },
    get notificationSound() { return notificationSound; },
    get notificationVolume() { return notificationVolume; },
    get migrateTabNotes() { return migrateTabNotes; },
    get notesScope() { return notesScope; },
    get showRecentWorkspaces() { return showRecentWorkspaces; },
    get workspaceSortOrder() { return workspaceSortOrder; },
    get showWorkspaceTabCount() { return showWorkspaceTabCount; },
    get triggers() { return triggers; },
    get hiddenDefaultTriggers() { return hiddenDefaultTriggers; },
    get claudeTriggersPrompted() { return claudeTriggersPrompted; },
    get claudeCodeIde() { return claudeCodeIde; },
    get windowsShell() { return windowsShell; },

    async load() {
      const prefs = await commands.getPreferences();
      fontSize = prefs.font_size;
      fontFamily = prefs.font_family;
      cursorStyle = prefs.cursor_style;
      cursorBlink = prefs.cursor_blink;
      autoSaveInterval = prefs.auto_save_interval;
      scrollbackLimit = prefs.scrollback_limit;
      promptPatterns = prefs.prompt_patterns;
      // Migration: add Windows shell patterns if missing
      const windowsPatterns = ['PS \\d>', '\\d>'];
      const missingPatterns = windowsPatterns.filter(p => !promptPatterns.includes(p));
      if (missingPatterns.length > 0) {
        promptPatterns = [...promptPatterns, ...missingPatterns];
      }
      cloneCwd = prefs.clone_cwd;
      cloneScrollback = prefs.clone_scrollback;
      cloneSsh = prefs.clone_ssh;
      cloneHistory = prefs.clone_history;
      cloneNotes = prefs.clone_notes ?? true;
      cloneAutoResume = prefs.clone_auto_resume ?? true;
      cloneVariables = prefs.clone_variables ?? true;
      theme = prefs.theme;
      shellTitleIntegration = prefs.shell_title_integration;
      shellIntegration = prefs.shell_integration ?? false;
      customThemes = prefs.custom_themes ?? [];
      restoreSession = prefs.restore_session ?? false;
      // Migration: derive notification_mode from old notify_on_completion if absent
      if (prefs.notification_mode) {
        notificationMode = prefs.notification_mode;
      } else {
        notificationMode = prefs.notify_on_completion ? 'auto' : 'disabled';
      }
      notifyMinDuration = prefs.notify_min_duration ?? 30;
      notesFontSize = prefs.notes_font_size ?? 16;
      notesFontFamily = prefs.notes_font_family ?? 'Menlo';
      notesWidth = prefs.notes_width ?? 320;
      notesWordWrap = prefs.notes_word_wrap ?? true;
      toastFontSize = prefs.toast_font_size ?? 14;
      toastWidth = prefs.toast_width ?? 400;
      toastDuration = prefs.toast_duration ?? 8;
      notificationSound = prefs.notification_sound ?? 'default';
      notificationVolume = prefs.notification_volume ?? 50;
      migrateTabNotes = prefs.migrate_tab_notes ?? true;
      notesScope = (prefs.notes_scope === 'workspace' ? 'workspace' : 'tab');
      showRecentWorkspaces = prefs.show_recent_workspaces ?? true;
      workspaceSortOrder = prefs.workspace_sort_order || 'default';
      showWorkspaceTabCount = prefs.show_workspace_tab_count ?? false;
      triggers = prefs.triggers ?? [];
      hiddenDefaultTriggers = prefs.hidden_default_triggers ?? [];
      claudeTriggersPrompted = prefs.claude_triggers_prompted ?? false;
      claudeCodeIde = prefs.claude_code_ide ?? false;
      windowsShell = prefs.windows_shell ?? 'powershell';
      _resolveReady();
    },

    async setFontSize(value: number) {
      fontSize = Math.max(10, Math.min(24, value));
      await this.save();
    },

    async setFontFamily(value: string) {
      fontFamily = value;
      await this.save();
    },

    async setCursorStyle(value: CursorStyle) {
      cursorStyle = value;
      await this.save();
    },

    async setCursorBlink(value: boolean) {
      cursorBlink = value;
      await this.save();
    },

    async setAutoSaveInterval(value: number) {
      autoSaveInterval = value;
      await this.save();
    },

    async setScrollbackLimit(value: number) {
      scrollbackLimit = value;
      await this.save();
    },

    async setPromptPatterns(value: string[]) {
      promptPatterns = value;
      await this.save();
    },

    async setCloneCwd(value: boolean) {
      cloneCwd = value;
      await this.save();
    },

    async setCloneScrollback(value: boolean) {
      cloneScrollback = value;
      await this.save();
    },

    async setCloneSsh(value: boolean) {
      cloneSsh = value;
      await this.save();
    },

    async setCloneHistory(value: boolean) {
      cloneHistory = value;
      await this.save();
    },

    async setCloneNotes(value: boolean) {
      cloneNotes = value;
      await this.save();
    },

    async setCloneAutoResume(value: boolean) {
      cloneAutoResume = value;
      await this.save();
    },

    async setCloneVariables(value: boolean) {
      cloneVariables = value;
      await this.save();
    },

    async setTheme(value: string) {
      theme = value;
      await this.save();
    },

    async setShellTitleIntegration(value: boolean) {
      shellTitleIntegration = value;
      await this.save();
    },

    async setShellIntegration(value: boolean) {
      shellIntegration = value;
      await this.save();
    },

    async setRestoreSession(value: boolean) {
      restoreSession = value;
      await this.save();
    },

    async setNotificationMode(value: string) {
      notificationMode = value;
      await this.save();
    },

    async setNotifyMinDuration(value: number) {
      notifyMinDuration = value;
      await this.save();
    },

    async setNotesFontSize(value: number) {
      notesFontSize = Math.max(10, Math.min(24, value));
      await this.save();
    },

    async setNotesFontFamily(value: string) {
      notesFontFamily = value;
      await this.save();
    },

    async setNotesWidth(value: number) {
      notesWidth = Math.max(200, Math.min(600, value));
      await this.save();
    },

    async setNotesWordWrap(value: boolean) {
      notesWordWrap = value;
      await this.save();
    },

    async setToastFontSize(value: number) {
      toastFontSize = Math.max(10, Math.min(24, value));
      await this.save();
    },

    async setToastWidth(value: number) {
      toastWidth = Math.max(280, Math.min(600, value));
      await this.save();
    },

    async setToastDuration(value: number) {
      toastDuration = Math.max(3, Math.min(30, value));
      await this.save();
    },

    async setNotificationSound(value: string) {
      notificationSound = value;
      await this.save();
    },

    async setNotificationVolume(value: number) {
      notificationVolume = Math.max(0, Math.min(100, value));
      await this.save();
    },

    async setMigrateTabNotes(value: boolean) {
      migrateTabNotes = value;
      await this.save();
    },

    async setNotesScope(value: 'tab' | 'workspace') {
      notesScope = value;
      await this.save();
    },

    async setShowRecentWorkspaces(value: boolean) {
      showRecentWorkspaces = value;
      await this.save();
    },

    async setWorkspaceSortOrder(value: string) {
      workspaceSortOrder = value;
      await this.save();
    },

    async setShowWorkspaceTabCount(value: boolean) {
      showWorkspaceTabCount = value;
      await this.save();
    },

    async setTriggers(value: Trigger[]) {
      triggers = value;
      await this.save();
    },

    async setHiddenDefaultTriggers(value: string[]) {
      hiddenDefaultTriggers = value;
      await this.save();
    },

    async setClaudeTriggersPrompted(value: boolean) {
      claudeTriggersPrompted = value;
      await this.save();
    },

    async setClaudeCodeIde(value: boolean) {
      claudeCodeIde = value;
      await this.save();
    },

    async setWindowsShell(value: string) {
      windowsShell = value;
      await this.save();
    },

    async addCustomTheme(t: Theme) {
      customThemes = [...customThemes, t];
      await this.save();
    },

    async updateCustomTheme(id: string, updated: Theme) {
      customThemes = customThemes.map((t) => (t.id === id ? updated : t));
      await this.save();
    },

    async deleteCustomTheme(id: string) {
      customThemes = customThemes.filter((t) => t.id !== id);
      if (theme === id) {
        theme = builtinThemes[0].id;
      }
      await this.save();
    },

    applyFromBackend(prefs: Preferences) {
      fontSize = prefs.font_size;
      fontFamily = prefs.font_family;
      cursorStyle = prefs.cursor_style;
      cursorBlink = prefs.cursor_blink;
      autoSaveInterval = prefs.auto_save_interval;
      scrollbackLimit = prefs.scrollback_limit;
      promptPatterns = prefs.prompt_patterns;
      cloneCwd = prefs.clone_cwd;
      cloneScrollback = prefs.clone_scrollback;
      cloneSsh = prefs.clone_ssh;
      cloneHistory = prefs.clone_history;
      cloneNotes = prefs.clone_notes ?? true;
      cloneAutoResume = prefs.clone_auto_resume ?? true;
      cloneVariables = prefs.clone_variables ?? true;
      theme = prefs.theme;
      shellTitleIntegration = prefs.shell_title_integration;
      shellIntegration = prefs.shell_integration ?? false;
      customThemes = prefs.custom_themes ?? [];
      restoreSession = prefs.restore_session ?? false;
      if (prefs.notification_mode) {
        notificationMode = prefs.notification_mode;
      } else {
        notificationMode = prefs.notify_on_completion ? 'auto' : 'disabled';
      }
      notifyMinDuration = prefs.notify_min_duration ?? 30;
      notesFontSize = prefs.notes_font_size ?? 16;
      notesFontFamily = prefs.notes_font_family ?? 'Menlo';
      notesWidth = prefs.notes_width ?? 320;
      notesWordWrap = prefs.notes_word_wrap ?? true;
      toastFontSize = prefs.toast_font_size ?? 14;
      toastWidth = prefs.toast_width ?? 400;
      toastDuration = prefs.toast_duration ?? 8;
      notificationSound = prefs.notification_sound ?? 'default';
      notificationVolume = prefs.notification_volume ?? 50;
      migrateTabNotes = prefs.migrate_tab_notes ?? true;
      notesScope = (prefs.notes_scope === 'workspace' ? 'workspace' : 'tab');
      showRecentWorkspaces = prefs.show_recent_workspaces ?? true;
      workspaceSortOrder = prefs.workspace_sort_order || 'default';
      showWorkspaceTabCount = prefs.show_workspace_tab_count ?? false;
      triggers = prefs.triggers ?? [];
      hiddenDefaultTriggers = prefs.hidden_default_triggers ?? [];
      claudeTriggersPrompted = prefs.claude_triggers_prompted ?? false;
      claudeCodeIde = prefs.claude_code_ide ?? false;
      windowsShell = prefs.windows_shell ?? 'powershell';
    },

    async save() {
      const prefs: Preferences = {
        font_size: fontSize,
        font_family: fontFamily,
        cursor_style: cursorStyle,
        cursor_blink: cursorBlink,
        auto_save_interval: autoSaveInterval,
        scrollback_limit: scrollbackLimit,
        prompt_patterns: promptPatterns,
        clone_cwd: cloneCwd,
        clone_scrollback: cloneScrollback,
        clone_ssh: cloneSsh,
        clone_history: cloneHistory,
        clone_notes: cloneNotes,
        clone_auto_resume: cloneAutoResume,
        clone_variables: cloneVariables,
        theme,
        shell_title_integration: shellTitleIntegration,
        shell_integration: shellIntegration,
        custom_themes: customThemes,
        restore_session: restoreSession,
        notify_on_completion: notificationMode !== 'disabled',
        notification_mode: notificationMode,
        notify_min_duration: notifyMinDuration,
        notes_font_size: notesFontSize,
        notes_font_family: notesFontFamily,
        notes_width: notesWidth,
        notes_word_wrap: notesWordWrap,
        toast_font_size: toastFontSize,
        toast_width: toastWidth,
        toast_duration: toastDuration,
        notification_sound: notificationSound,
        notification_volume: notificationVolume,
        migrate_tab_notes: migrateTabNotes,
        notes_scope: notesScope === 'workspace' ? 'workspace' : null,
        show_recent_workspaces: showRecentWorkspaces,
        workspace_sort_order: workspaceSortOrder === 'default' ? '' : workspaceSortOrder,
        show_workspace_tab_count: showWorkspaceTabCount,
        triggers,
        hidden_default_triggers: hiddenDefaultTriggers,
        claude_triggers_prompted: claudeTriggersPrompted,
        claude_code_ide: claudeCodeIde,
        windows_shell: windowsShell,
      };
      await commands.setPreferences(prefs);
    }
  };
}

export const preferencesStore = createPreferencesStore();
