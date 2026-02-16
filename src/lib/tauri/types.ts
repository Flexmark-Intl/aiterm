export interface Tab {
  id: string;
  name: string;
  pty_id: string | null;
  scrollback: string | null;
  custom_name: boolean;
  restore_cwd: string | null;
  restore_ssh_command: string | null;
  restore_remote_cwd: string | null;
  auto_resume_cwd: string | null;
  auto_resume_ssh_command: string | null;
  auto_resume_remote_cwd: string | null;
  auto_resume_command: string | null;
  auto_resume_remembered_command: string | null;
  notes: string | null;
  notes_mode: string | null;
  notes_open: boolean;
  trigger_variables: Record<string, string>;
}

export interface Pane {
  id: string;
  name: string;
  tabs: Tab[];
  active_tab_id: string | null;
}

export type SplitDirection = 'horizontal' | 'vertical';

export interface SplitLeaf {
  type: 'leaf';
  pane_id: string;
}

export interface SplitBranch {
  type: 'split';
  id: string;
  direction: SplitDirection;
  ratio: number;
  children: [SplitNode, SplitNode];
}

export type SplitNode = SplitLeaf | SplitBranch;

export interface Workspace {
  id: string;
  name: string;
  panes: Pane[];
  active_pane_id: string | null;
  split_root: SplitNode | null;
}

export type CursorStyle = 'block' | 'underline' | 'bar';

export type TriggerActionType = 'notify' | 'send_command';

export interface TriggerActionEntry {
  action_type: TriggerActionType;
  command: string | null;
  message: string | null;
}

export interface VariableMapping {
  name: string;
  group: number;
  template?: string;
}

export interface Trigger {
  id: string;
  name: string;
  description?: string | null;
  pattern: string;
  actions: TriggerActionEntry[];
  enabled: boolean;
  workspaces: string[];
  cooldown: number;
  variables: VariableMapping[];
  default_id?: string | null;
}

export interface Preferences {
  font_size: number;
  font_family: string;
  cursor_style: CursorStyle;
  cursor_blink: boolean;
  auto_save_interval: number;
  scrollback_limit: number;
  prompt_patterns: string[];
  clone_cwd: boolean;
  clone_scrollback: boolean;
  clone_ssh: boolean;
  clone_history: boolean;
  clone_notes: boolean;
  clone_auto_resume: boolean;
  clone_variables: boolean;
  theme: string;
  shell_title_integration: boolean;
  shell_integration: boolean;
  custom_themes: import('$lib/themes').Theme[];
  restore_session: boolean;
  notify_on_completion: boolean;
  notification_mode: string;
  notify_min_duration: number;
  notes_font_size: number;
  notes_font_family: string;
  notes_width: number;
  notes_word_wrap: boolean;
  triggers: Trigger[];
  hidden_default_triggers: string[];
}

export interface WindowData {
  id: string;
  label: string;
  workspaces: Workspace[];
  active_workspace_id: string | null;
  sidebar_width: number;
  sidebar_collapsed: boolean;
}

export interface DuplicateWorkspaceResult {
  workspace: Workspace;
  tab_id_map: Record<string, string>;
}

export interface AppData {
  windows: WindowData[];
  preferences: Preferences;
}
