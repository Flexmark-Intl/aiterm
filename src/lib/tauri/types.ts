export interface Tab {
  id: string;
  name: string;
  pty_id: string | null;
  scrollback: string | null;
}

export interface PaneSizes {
  horizontal: Record<string, number>;
  vertical: Record<string, number>;
  grid: Record<string, number>;
}

export interface Pane {
  id: string;
  name: string;
  tabs: Tab[];
  active_tab_id: string | null;
}

export interface Workspace {
  id: string;
  name: string;
  panes: Pane[];
  active_pane_id: string | null;
  pane_sizes: PaneSizes;
}

export type Layout = 'horizontal' | 'vertical' | 'grid';

export type CursorStyle = 'block' | 'underline' | 'bar';

export interface Preferences {
  font_size: number;
  font_family: string;
  cursor_style: CursorStyle;
  cursor_blink: boolean;
  auto_save_interval: number;
  scrollback_limit: number;
}

export interface AppData {
  workspaces: Workspace[];
  active_workspace_id: string | null;
  layout: Layout;
  sidebar_width: number;
  preferences: Preferences;
}
