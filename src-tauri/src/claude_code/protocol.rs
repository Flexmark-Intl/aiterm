use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub struct JsonRpcRequest {
    pub id: Option<Value>,
    pub method: String,
    pub params: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: &'static str,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
}

impl JsonRpcResponse {
    pub fn success(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: Some(result),
            error: None,
        }
    }

    pub fn error(id: Value, code: i32, message: String) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(JsonRpcError { code, message }),
        }
    }
}

pub fn tool_list_response() -> Value {
    serde_json::json!({
        "tools": [
            {
                "name": "getOpenEditors",
                "description": "Get a list of all currently open editor tabs in the aiTerm IDE. Returns file paths, active state, language, and dirty (unsaved changes) status.",
                "inputSchema": { "type": "object", "properties": {}, "required": [] }
            },
            {
                "name": "getWorkspaceFolders",
                "description": "Get the workspace folder paths currently open in aiTerm. Returns root paths for each workspace.",
                "inputSchema": { "type": "object", "properties": {}, "required": [] }
            },
            {
                "name": "getDiagnostics",
                "description": "Get app diagnostics: version, tab/PTY counts, orphaned PTYs, WebGL status, buffer sizes, state file size, PTY throughput, state save timing, trigger engine stats, render FPS, process memory/CPU, memory trend. Use this to investigate performance issues or health of the running aiTerm instance. Note: FPS probe takes ~1 second to measure.",
                "inputSchema": { "type": "object", "properties": {}, "required": [] }
            },
            {
                "name": "readLogs",
                "description": "Read recent log entries from the aiTerm log file. Returns the last N lines, optionally filtered by log level or search string. Use this to investigate errors, warnings, or trace application behavior.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "lines": { "type": "number", "description": "Number of lines to return (default: 100, max: 1000). Returns the most recent lines." },
                        "level": { "type": "string", "description": "Filter by log level: DEBUG, INFO, WARN, ERROR. Only lines containing this level are returned." },
                        "search": { "type": "string", "description": "Filter lines containing this substring (case-sensitive)." }
                    },
                    "required": []
                }
            },
            {
                "name": "checkDocumentDirty",
                "description": "Check whether a document open in the aiTerm editor has unsaved changes.",
                "inputSchema": { "type": "object", "properties": { "filePath": { "type": "string" } }, "required": ["filePath"] }
            },
            {
                "name": "saveDocument",
                "description": "Save a document that is open in the aiTerm editor to disk.",
                "inputSchema": { "type": "object", "properties": { "filePath": { "type": "string" } }, "required": ["filePath"] }
            },
            {
                "name": "getCurrentSelection",
                "description": "Get the currently selected text and cursor position in the active aiTerm editor tab.",
                "inputSchema": { "type": "object", "properties": {}, "required": [] }
            },
            {
                "name": "getLatestSelection",
                "description": "Get the most recent text selection made in any aiTerm editor tab.",
                "inputSchema": { "type": "object", "properties": {}, "required": [] }
            },
            {
                "name": "openFile",
                "description": "Open a file in the aiTerm IDE editor tab. Use this tool whenever you need to show the user a file — do NOT use shell 'open' or other OS commands. Supports optional line range or text range selection to highlight a specific section.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "filePath": { "type": "string", "description": "Absolute path to the file to open" },
                        "startLine": { "type": "number", "description": "Line number to start selection (1-based)" },
                        "endLine": { "type": "number", "description": "Line number to end selection (1-based)" },
                        "startText": { "type": "string", "description": "Text string to find and start selection at" },
                        "endText": { "type": "string", "description": "Text string to find and end selection at" }
                    },
                    "required": ["filePath"]
                }
            },
            {
                "name": "openDiff",
                "description": "Show a diff of proposed file changes in the aiTerm IDE for the user to review, accept, or reject. Use this tool instead of directly writing files when you want the user to review changes. This is a blocking call — it waits for the user to accept or reject before returning.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "old_file_path": { "type": "string", "description": "Path to the original file (used to read current content)" },
                        "new_file_path": { "type": "string", "description": "Path where the modified file should be saved" },
                        "new_file_contents": { "type": "string", "description": "The complete new file contents to show in the diff" },
                        "tab_name": { "type": "string", "description": "Display name for the diff tab" }
                    },
                    "required": ["new_file_path", "new_file_contents"]
                }
            },
            {
                "name": "closeAllDiffTabs",
                "description": "Close all open diff review tabs in the aiTerm IDE, rejecting any pending changes.",
                "inputSchema": { "type": "object", "properties": {}, "required": [] }
            },
            {
                "name": "listWindows",
                "description": "List all aiTerm windows with their IDs, labels, and workspace summaries. Use this to discover windows before querying a specific window's workspaces via listWorkspaces with a windowId.",
                "inputSchema": { "type": "object", "properties": {}, "required": [] }
            },
            {
                "name": "listWorkspaces",
                "description": "List all workspaces with their panes and tabs. Returns windowId, windowLabel, workspace IDs, names, pane structure, tab IDs, interpolated display names, tab types, active states, and notes indicators. Use this to discover tabs for switchTab or notes operations. Each aiTerm window has its own set of workspaces; pass windowId to query a specific window.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "windowId": { "type": "string", "description": "Window ID (UUID) to list workspaces from. If omitted, uses the window this terminal belongs to." }
                    },
                    "required": []
                }
            },
            {
                "name": "switchTab",
                "description": "Navigate to a specific tab by its ID. Automatically switches to the correct workspace and pane. Use listWorkspaces first to discover tab IDs.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "tabId": { "type": "string", "description": "The tab ID to navigate to" }
                    },
                    "required": ["tabId"]
                }
            },
            {
                "name": "getTabNotes",
                "description": "Read the notes content for a terminal or editor tab. Returns the notes text and display mode.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "tabId": { "type": "string", "description": "Tab ID to read notes from. If omitted, uses the currently active tab." }
                    },
                    "required": []
                }
            },
            {
                "name": "setTabNotes",
                "description": "Write or clear notes for a terminal or editor tab. Set notes to null or empty string to clear.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "tabId": { "type": "string", "description": "Tab ID to write notes to. If omitted, uses the currently active tab." },
                        "notes": { "type": ["string", "null"], "description": "The notes content (markdown supported). Set to null or empty to clear." },
                        "mode": { "type": "string", "description": "Display mode: 'source' (edit) or 'render' (preview). Optional." }
                    },
                    "required": ["notes"]
                }
            },
            {
                "name": "listWorkspaceNotes",
                "description": "List all notes attached to a workspace (not tab-level notes). Returns note IDs, content previews, modes, and timestamps.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "workspaceId": { "type": "string", "description": "Workspace ID. If omitted, uses the active workspace." }
                    },
                    "required": []
                }
            },
            {
                "name": "readWorkspaceNote",
                "description": "Read the full content of a workspace-level note by its ID.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "workspaceId": { "type": "string", "description": "Workspace ID. If omitted, uses the active workspace." },
                        "noteId": { "type": "string", "description": "The note ID to read" }
                    },
                    "required": ["noteId"]
                }
            },
            {
                "name": "writeWorkspaceNote",
                "description": "Create a new workspace-level note or update an existing one. Omit noteId to create, include noteId to update.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "workspaceId": { "type": "string", "description": "Workspace ID. If omitted, uses the active workspace." },
                        "noteId": { "type": "string", "description": "Note ID to update. Omit to create a new note." },
                        "content": { "type": "string", "description": "The note content (markdown supported)" },
                        "mode": { "type": ["string", "null"], "description": "Display mode: 'source' or 'render'. Optional." }
                    },
                    "required": ["content"]
                }
            },
            {
                "name": "deleteWorkspaceNote",
                "description": "Delete a workspace-level note by its ID.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "workspaceId": { "type": "string", "description": "Workspace ID. If omitted, uses the active workspace." },
                        "noteId": { "type": "string", "description": "The note ID to delete" }
                    },
                    "required": ["noteId"]
                }
            },
            {
                "name": "moveNote",
                "description": "Move a note between tab and workspace levels. 'tab_to_workspace' copies tab notes into a new workspace note and clears the tab. 'workspace_to_tab' moves a workspace note into a tab's notes and deletes the workspace note. Fails if the destination already has content — use force: true to overwrite, or read both notes first to merge manually.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "direction": { "type": "string", "description": "'tab_to_workspace' or 'workspace_to_tab'" },
                        "tabId": { "type": "string", "description": "Tab ID. If omitted, uses the active tab." },
                        "workspaceId": { "type": "string", "description": "Workspace ID. If omitted, uses the active workspace." },
                        "noteId": { "type": "string", "description": "Workspace note ID. Required for 'workspace_to_tab' direction." },
                        "force": { "type": "boolean", "description": "If true, overwrite destination content instead of failing on conflict. Default: false." }
                    },
                    "required": ["direction"]
                }
            },
            {
                "name": "getTabContext",
                "description": "Get recent terminal output or editor content from tabs to understand what the user was working on. If fewer than 10 total tabs exist, returns context for all tabs automatically. Otherwise, pass specific tab IDs. Each result includes the interpolated tab display name (highest-weight match signal), workspace name, tab type, and the last N lines of content. Use this to find the right tab when the user says things like 'switch to the tab where I was working on X'.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "tabIds": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Specific tab IDs to get context from. If omitted and total tabs < 10, returns all tabs."
                        },
                        "lines": {
                            "type": "number",
                            "description": "Number of recent lines to return per tab. Default: 50."
                        }
                    },
                    "required": []
                }
            },
            {
                "name": "openNotesPanel",
                "description": "Open or close the notes panel for the current active tab. The panel shows either tab-level or workspace-level notes depending on the current scope.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "open": { "type": "boolean", "description": "True to open, false to close. If omitted, toggles the current state." }
                    },
                    "required": []
                }
            },
            {
                "name": "setNotesScope",
                "description": "Switch the notes panel view between tab-level notes and workspace-level notes. The scope persists across tabs.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "scope": { "type": "string", "description": "Either 'tab' for per-tab notes or 'workspace' for workspace-level notes" }
                    },
                    "required": ["scope"]
                }
            },
            {
                "name": "getActiveTab",
                "description": "Get the currently active workspace, pane, and tab in the current window. Returns windowLabel, IDs, names, tab type, display name, and notes status. Use this as a lightweight alternative to listWorkspaces when you just need to know the current context. Prefer reading $AITERM_TAB_ID for your own tab ID instead of calling this.",
                "inputSchema": { "type": "object", "properties": {}, "required": [] }
            },
            {
                "name": "setTriggerVariable",
                "description": "Set or clear a trigger variable for a terminal tab. Trigger variables like %claudeSessionId are used in auto-resume commands and tab title interpolation. Setting 'claudeSessionId' will automatically enable auto-resume if the default Claude triggers are active — this is the recommended way to set up auto-resume for a Claude Code session. Set value to null to clear a variable.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "tabId": { "type": "string", "description": "Tab ID. If omitted, uses the currently active tab." },
                        "name": { "type": "string", "description": "Variable name (e.g. 'claudeSessionId'). Referenced as %name in commands and titles." },
                        "value": { "type": ["string", "null"], "description": "Value to set. Pass null to clear the variable." }
                    },
                    "required": ["name", "value"]
                }
            },
            {
                "name": "getTriggerVariables",
                "description": "Get all trigger variables for a terminal tab. Returns variable names and values used in auto-resume commands, tab titles, and trigger conditions.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "tabId": { "type": "string", "description": "Tab ID. If omitted, uses the currently active tab." }
                    },
                    "required": []
                }
            },
            {
                "name": "setAutoResume",
                "description": "Enable or disable auto-resume for a terminal tab. When enabled, the tab will automatically replay the configured command on session restore. Disabling preserves all stored settings (SSH, CWD, command) — it only stops the auto-resume from firing. For Claude Code sessions, prefer using setTriggerVariable to set 'claudeSessionId' instead — this triggers auto-resume setup automatically with correct PTY context detection.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "tabId": { "type": "string", "description": "Tab ID. If omitted, uses the currently active tab." },
                        "enabled": { "type": "boolean", "description": "True to enable, false to disable. Disabling preserves all stored settings." },
                        "command": { "type": "string", "description": "Command to execute on resume. If omitted when enabling, uses the default Claude resume command template." },
                        "cwd": { "type": "string", "description": "Local working directory. If omitted, auto-detected from PTY." },
                        "sshCommand": { "type": "string", "description": "SSH connection target (e.g. 'user@host' or '-p 2222 user@host'). If omitted, auto-detected from PTY." },
                        "remoteCwd": { "type": "string", "description": "Remote working directory for SSH sessions. If omitted, auto-detected." }
                    },
                    "required": ["enabled"]
                }
            },
            {
                "name": "getAutoResume",
                "description": "Get the current auto-resume configuration for a terminal tab. Returns enabled state, pinned state, configured flag, and the stored command, CWD, SSH command, and remote CWD.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "tabId": { "type": "string", "description": "Tab ID. If omitted, uses the currently active tab." }
                    },
                    "required": []
                }
            },
            {
                "name": "findNotes",
                "description": "Search across all workspaces and tabs for notes content. Returns every tab and workspace note that exists, with content previews and tab display names. Use this to quickly find notes without having to list workspaces and check each tab individually.",
                "inputSchema": { "type": "object", "properties": {}, "required": [] }
            },
            {
                "name": "getPreferences",
                "description": "Get aiTerm preferences (settings). Returns current values with metadata (description, type, valid values). Optionally filter by query string to find relevant settings.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "Optional search query. Filters preferences whose key or description contains this string (case-insensitive). Omit to return all preferences." }
                    },
                    "required": []
                }
            },
            {
                "name": "setPreference",
                "description": "Update a single aiTerm preference by key. Use getPreferences first to discover available keys, their types, and valid values.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "key": { "type": "string", "description": "The preference key in snake_case (e.g. 'font_size', 'theme', 'cursor_style')" },
                        "value": { "description": "The new value. Type must match the preference (number, string, boolean)." }
                    },
                    "required": ["key", "value"]
                }
            }
        ]
    })
}

pub fn initialize_response() -> Value {
    serde_json::json!({
        "protocolVersion": "2024-11-05",
        "capabilities": { "tools": {} },
        "serverInfo": { "name": crate::APP_DISPLAY_NAME, "version": crate::APP_VERSION },
        "instructions": "You are running inside an aiTerm terminal tab. Your tab ID is available in the environment variable AITERM_TAB_ID. Always read $AITERM_TAB_ID and pass it as the 'tabId' parameter when calling tools that accept one (setTabNotes, getTabNotes, setTriggerVariable, getTriggerVariables, setAutoResume, getAutoResume, etc.). This ensures operations target YOUR terminal tab, not whichever tab the user happens to be looking at."
    })
}
