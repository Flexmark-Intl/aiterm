export type TabType = 'terminal' | 'editor' | 'diff';

export interface EditorFileInfo {
  file_path: string;
  is_remote: boolean;
  remote_ssh_command: string | null;
  remote_path: string | null;
  language: string | null;
}

export interface DiffContext {
  request_id: string;
  file_path: string;
  old_content: string;
  new_content: string;
  tab_name: string;
}

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
  last_cwd: string | null;
  archived_name: string | null;
  archived_at: string | null;
  tab_type: TabType;
  editor_file: EditorFileInfo | null;
  diff_context: DiffContext | null;
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

export interface WorkspaceNote {
  id: string;
  content: string;
  mode: string | null;
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  panes: Pane[];
  active_pane_id: string | null;
  split_root: SplitNode | null;
  workspace_notes: WorkspaceNote[];
  archived_tabs: Tab[];
}

export type CursorStyle = 'block' | 'underline' | 'bar';

export type TriggerActionType = 'notify' | 'send_command' | 'set_tab_state' | 'enable_auto_resume';

export type MatchMode = 'regex' | 'plain_text' | 'variable';

export type TabStateName = 'alert' | 'question';

export interface TriggerActionEntry {
  action_type: TriggerActionType;
  command: string | null;
  title: string | null;
  message: string | null;
  tab_state: TabStateName | null;
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
  plain_text: boolean;
  match_mode?: MatchMode | null;
  default_id?: string | null;
  user_modified?: boolean;
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
  toast_font_size: number;
  toast_width: number;
  toast_duration: number;
  notification_sound: string;
  notification_volume: number;
  migrate_tab_notes: boolean;
  notes_scope: string | null;
  show_recent_workspaces: boolean;
  workspace_sort_order: string;
  show_workspace_tab_count: boolean;
  triggers: Trigger[];
  hidden_default_triggers: string[];
  claude_triggers_prompted: boolean;
  claude_code_ide: boolean;
  windows_shell: string;
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

export interface ShellInfo {
  id: string;
  name: string;
  path: string;
}

export interface ClaudeCodeToolRequest {
  request_id: string;
  tool: string;
  arguments: Record<string, unknown>;
}
