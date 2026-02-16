// Strip ANSI escape sequences (CSI, OSC, charset, and C0/C1 control codes) from terminal text.
const ANSI_RE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][0-9A-B]|[^[\]()])|[\x00-\x08\x0e-\x1f]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}
