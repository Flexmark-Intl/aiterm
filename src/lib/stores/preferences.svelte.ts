import type { CursorStyle, Preferences } from '$lib/tauri/types';
import type { Theme } from '$lib/themes';
import { builtinThemes } from '$lib/themes';
import * as commands from '$lib/tauri/commands';

function createPreferencesStore() {
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
  let theme = $state('tokyo-night');
  let shellTitleIntegration = $state(false);
  let customThemes = $state<Theme[]>([]);
  let restoreSession = $state(false);

  return {
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
    get theme() { return theme; },
    get shellTitleIntegration() { return shellTitleIntegration; },
    get customThemes() { return customThemes; },
    get restoreSession() { return restoreSession; },

    async load() {
      const prefs = await commands.getPreferences();
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
      theme = prefs.theme;
      shellTitleIntegration = prefs.shell_title_integration;
      customThemes = prefs.custom_themes ?? [];
      restoreSession = prefs.restore_session ?? false;
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

    async setTheme(value: string) {
      theme = value;
      await this.save();
    },

    async setShellTitleIntegration(value: boolean) {
      shellTitleIntegration = value;
      await this.save();
    },

    async setRestoreSession(value: boolean) {
      restoreSession = value;
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
        theme,
        shell_title_integration: shellTitleIntegration,
        custom_themes: customThemes,
        restore_session: restoreSession,
      };
      await commands.setPreferences(prefs);
    }
  };
}

export const preferencesStore = createPreferencesStore();
