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
                "description": "Get language diagnostics (errors, warnings) for a file in the aiTerm editor.",
                "inputSchema": { "type": "object", "properties": { "uri": { "type": "string" } }, "required": [] }
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
            }
        ]
    })
}

pub fn initialize_response() -> Value {
    serde_json::json!({
        "protocolVersion": "2024-11-05",
        "capabilities": { "tools": {} },
        "serverInfo": { "name": crate::APP_DISPLAY_NAME, "version": crate::APP_VERSION }
    })
}
