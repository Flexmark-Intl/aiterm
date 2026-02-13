/**
 * Generate shell integration snippets for remote shells.
 * These are designed to be sent to a running PTY (e.g. over SSH).
 * Must work at an interactive bash or zsh prompt.
 *
 * Two modes:
 *  - Session: one-liner sent to the current shell (temporary, lost on exit)
 *  - Install: writes clean hooks to ~/.bashrc or ~/.zshrc (permanent)
 */

// --- Bash PROMPT_COMMAND content fragments (no assignment wrapper) ---

/** OSC 133 D+A: report command completion and prompt start. */
const BASH_PC_OSC133 = `__aiterm_ec=\\$?; printf '\\033]133;D;%d\\007' \\"\\$__aiterm_ec\\"; printf '\\033]133;A\\007'`;

/** Title: set terminal title to user@host:path. */
const BASH_PC_TITLE = `printf '\\033]0;%s@%s:%s\\007' \\"\\\${USER}\\" \\"\\\${HOSTNAME%%.*}\\" \\"\\\${PWD/#\$HOME/~}\\"`;

/** Guard flag — must be the LAST item in PROMPT_COMMAND so the DEBUG trap
 *  only fires for user commands, not for commands within PROMPT_COMMAND. */
const BASH_PC_AT_PROMPT = `__aiterm_at_prompt=1`;

/** DEBUG trap for B (command start) — guarded so it only fires once per prompt. */
const BASH_TRAP = `trap '[[ "\$__aiterm_at_prompt" == 1 ]] && __aiterm_at_prompt= && printf "\\033]133;B\\007"' DEBUG`;

// --- Zsh snippets (self-contained, use add-zsh-hook) ---

const ZSH_TITLE = [
  `autoload -Uz add-zsh-hook`,
  `_aiterm_title_precmd(){ printf '\\033]0;%s@%s:%s\\007' "\${USER}" "\${HOST%%.*}" "\${PWD/#\$HOME/~}"; }`,
  `add-zsh-hook precmd _aiterm_title_precmd`,
].join('; ');

const ZSH_OSC133 = [
  `autoload -Uz add-zsh-hook`,
  `_aiterm_osc133_precmd(){ print -Pn '\\e]133;D;%?\\a\\e]133;A\\a'; }`,
  `_aiterm_osc133_preexec(){ print -Pn '\\e]133;B\\a'; }`,
  `add-zsh-hook precmd _aiterm_osc133_precmd`,
  `add-zsh-hook preexec _aiterm_osc133_preexec`,
].join('; ');

/**
 * Build a shell integration snippet for the given preferences.
 * Returns a string to send to the PTY (with trailing newline),
 * or null if nothing is enabled.
 */
export function buildShellIntegrationSnippet(opts: {
  shellTitle: boolean;
  shellIntegration: boolean;
}): string | null {
  if (!opts.shellTitle && !opts.shellIntegration) return null;

  // --- Bash: build a single PROMPT_COMMAND assignment + optional trap ---
  const pcParts: string[] = [];   // content inside PROMPT_COMMAND="..."
  const bashExtra: string[] = []; // commands after the assignment (trap)

  if (opts.shellIntegration) {
    pcParts.push(BASH_PC_OSC133);
  }
  if (opts.shellTitle) {
    pcParts.push(BASH_PC_TITLE);
  }
  if (opts.shellIntegration) {
    // Guard flag MUST be last in PROMPT_COMMAND
    pcParts.push(BASH_PC_AT_PROMPT);
    bashExtra.push(BASH_TRAP);
  }

  const pcContent = pcParts.join('; ');
  const pcAssign = `PROMPT_COMMAND="\${PROMPT_COMMAND:+\$PROMPT_COMMAND; }${pcContent}"`;
  const bash = [pcAssign, ...bashExtra].join('; ');

  // --- Zsh: self-contained hook registrations ---
  const zshParts: string[] = [];
  if (opts.shellIntegration) {
    zshParts.push(ZSH_OSC133);
  }
  if (opts.shellTitle) {
    zshParts.push(ZSH_TITLE);
  }
  const zsh = zshParts.join('; ');

  return `if [ -n "$ZSH_VERSION" ]; then ${zsh}; elif [ -n "$BASH_VERSION" ]; then ${bash}; fi`;
}

/**
 * Build a shell command that permanently installs shell integration hooks
 * into the user's rc file (~/.bashrc or ~/.zshrc).
 *
 * Always installs both title and OSC 133 hooks (the full experience).
 * Idempotent: checks for existing marker before writing, guards against
 * duplicate PROMPT_COMMAND entries on re-source.
 *
 * Returns a single-line string to send to the PTY. Uses printf '%s\n'
 * with single-quoted arguments to write file content (no heredocs —
 * heredocs break when pasted into interactive shells).
 */
export function buildInstallSnippet(): string {
  // Escape a string for use as a single-quoted shell argument.
  // Each ' becomes '\'' (end quote, escaped literal quote, restart quote).
  function sq(s: string): string {
    return "'" + s.replace(/'/g, "'\\''") + "'";
  }

  // Lines to write to ~/.zshrc (literal text — no shell expansion at write time)
  const zshLines = [
    "",
    "# aiterm-shell-integration",
    "autoload -Uz add-zsh-hook",
    "_aiterm_precmd() {",
    "  print -Pn '\\e]133;D;%?\\a\\e]133;A\\a'",
    "  printf '\\033]0;%s@%s:%s\\007' \"$USER\" \"${HOST%%.*}\" \"${PWD/#$HOME/~}\"",
    "}",
    "_aiterm_preexec() {",
    "  print -Pn '\\e]133;B\\a'",
    "}",
    "add-zsh-hook precmd _aiterm_precmd",
    "add-zsh-hook preexec _aiterm_preexec",
  ];

  // Lines to write to ~/.bashrc (literal text — no shell expansion at write time)
  const bashLines = [
    "",
    "# aiterm-shell-integration",
    "__aiterm_pc() {",
    "  local ec=$?",
    "  printf '\\033]133;D;%d\\007' \"$ec\"",
    "  printf '\\033]133;A\\007'",
    "  printf '\\033]0;%s@%s:%s\\007' \"$USER\" \"${HOSTNAME%%.*}\" \"${PWD/#$HOME/~}\"",
    "  __aiterm_at_prompt=1",
    "}",
    "[[ \"$PROMPT_COMMAND\" != *\"__aiterm_pc\"* ]] && PROMPT_COMMAND=\"${PROMPT_COMMAND:+$PROMPT_COMMAND; }__aiterm_pc\"",
    "[[ -z \"$__aiterm_trap\" ]] && __aiterm_trap=1 && trap '[[ \"$__aiterm_at_prompt\" == 1 ]] && __aiterm_at_prompt= && printf \"\\033]133;B\\007\"' DEBUG",
  ];

  // printf '%s\n' 'line1' 'line2' ... writes each line followed by newline
  const zshPrintf = "printf '%s\\n' " + zshLines.map(sq).join(' ');
  const bashPrintf = "printf '%s\\n' " + bashLines.map(sq).join(' ');

  // Single-line command: detect shell → check marker → write via printf → source
  return [
    "if [ -n \"$ZSH_VERSION\" ]; then __f=~/.zshrc;",
    "elif [ -n \"$BASH_VERSION\" ]; then __f=~/.bashrc;",
    "else printf '\\n\\033[1;31m%s\\033[0m\\n\\n' 'aiTerm: unsupported shell'; false; fi",
    "&& if ! grep -q '# aiterm-shell-integration' \"$__f\" 2>/dev/null; then",
    "{ if [ -n \"$ZSH_VERSION\" ]; then " + zshPrintf + ";",
    "else " + bashPrintf + "; fi; } >> \"$__f\"",
    "&& . \"$__f\" && printf '\\n\\033[1;32m%s\\033[0m\\n\\n' \"aiTerm: installed in $__f\";",
    "else printf '\\n\\033[1;33m%s\\033[0m\\n\\n' \"aiTerm: already installed in $__f\"; fi",
  ].join(' ');
}
