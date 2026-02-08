import type { CursorStyle, Preferences } from '$lib/tauri/types';
import * as commands from '$lib/tauri/commands';

function createPreferencesStore() {
  let fontSize = $state(13);
  let fontFamily = $state('Menlo');
  let cursorStyle = $state<CursorStyle>('block');
  let cursorBlink = $state(true);
  let autoSaveInterval = $state(10);
  let scrollbackLimit = $state(10000);

  return {
    get fontSize() { return fontSize; },
    get fontFamily() { return fontFamily; },
    get cursorStyle() { return cursorStyle; },
    get cursorBlink() { return cursorBlink; },
    get autoSaveInterval() { return autoSaveInterval; },
    get scrollbackLimit() { return scrollbackLimit; },

    async load() {
      const prefs = await commands.getPreferences();
      fontSize = prefs.font_size;
      fontFamily = prefs.font_family;
      cursorStyle = prefs.cursor_style;
      cursorBlink = prefs.cursor_blink;
      autoSaveInterval = prefs.auto_save_interval;
      scrollbackLimit = prefs.scrollback_limit;
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

    async save() {
      const prefs: Preferences = {
        font_size: fontSize,
        font_family: fontFamily,
        cursor_style: cursorStyle,
        cursor_blink: cursorBlink,
        auto_save_interval: autoSaveInterval,
        scrollback_limit: scrollbackLimit,
      };
      await commands.setPreferences(prefs);
    }
  };
}

export const preferencesStore = createPreferencesStore();
