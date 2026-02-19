/**
 * Generate shell integration snippets for remote shells.
 * These are designed to be sent to a running PTY (e.g. over SSH).
 * Must work at an interactive bash or zsh prompt.
 *
 * Two modes:
 *  - Session: one-liner sent to the current shell (temporary, lost on exit)
 *  - Install: writes clean hooks to ~/.bashrc or ~/.zshrc (permanent)
 *
 * Both modes include the `l` command (ls with clickable file links via OSC 8).
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

// --- Editor file links: `l` command (ls with OSC 8 hyperlinks) ---

/** Session one-liner for the `l` command. On GNU/Linux uses native --hyperlink,
 *  on macOS/BSD falls back to an awk post-processor. */
function buildLsSetupOneLiner(): string {
  const alias = "alias l='ls --hyperlink=auto -la'";

  // macOS/BSD fallback — awk injects OSC 8 around each filename
  // Shared awk script for both single-dir and multi-file modes
  const awkBody = [
    "    /^$/ { print; next }",
    "    /^total / { print; next }",
    "    /^d/ { print; next }",
    "    /^[lcbps-]/ {",
    "      if (match($0, /^[^ ]+ +[0-9]+ +[^ ]+ +[^ ]+ +[0-9,]+ +[A-Za-z]+ +[0-9]+ +[0-9:]+/)) {",
    "        pre = substr($0, 1, RLENGTH);",
    "        rest = substr($0, RLENGTH + 1);",
    "        sub(/^ +/, \" \", rest);",
    "        fname = substr(rest, 2);",
    "        if (fname == \".\" || fname == \"..\") { print; next }",
    "        link_target = \"\";",
    "        if (index(fname, \" -> \") > 0) {",
    "          idx = index(fname, \" -> \");",
    "          link_target = substr(fname, idx);",
    "          fname = substr(fname, 1, idx - 1);",
    "        }",
    "        if (substr(fname, 1, 1) == \"/\") { fpath = fname; } else { fpath = dir \"/\" fname; }",
    "        gsub(/ /, \"%20\", fpath);",
    "        gsub(/\\(/, \"%28\", fpath);",
    "        gsub(/\\)/, \"%29\", fpath);",
    "        printf \"%s \\033]8;;file://%s\\033\\\\%s\\033]8;;\\033\\\\%s\\n\", pre, fpath, fname, link_target;",
    "        next;",
    "      }",
    "      print; next",
    "    }",
    "    { print }",
  ].join(' ');
  const fn = [
    "l() {",
    "  local _args=\"\" _nondash=0;",
    "  for _a in \"$@\"; do",
    "    case \"$_a\" in -*) _args=\"$_args $_a\";; *) _nondash=$((_nondash+1));; esac;",
    "  done;",
    "  if [ \"$_nondash\" -le 1 ]; then",
    "    local _d=\"\";",
    "    for _a in \"$@\"; do case \"$_a\" in -*) ;; *) _d=\"$_a\";; esac; done;",
    "    [ -z \"$_d\" ] && _d=\".\";",
    "    local _abs; _abs=$(cd \"$_d\" 2>/dev/null && pwd -P) || { ls -la \"$@\"; return; };",
    `    ls -la $_args "$_d" | awk -v dir="$_abs" '${awkBody}';`,
    "  else",
    "    local _pwd; _pwd=$(pwd -P);",
    `    ls -la $_args "$@" | awk -v dir="$_pwd" '${awkBody}';`,
    "  fi;",
    "}",
  ].join(' ');

  return `unalias l 2>/dev/null\nif ls --hyperlink=auto / >/dev/null 2>&1; then ${alias}; else ${fn}; fi`;
}

/** Lines to append to rc files for the permanent `l` command install.
 *  Same for both bash and zsh — uses POSIX-compatible syntax. */
const L_FUNCTION_RC_LINES = [
  "",
  "# aiterm-editor-links",
  "unalias l 2>/dev/null",
  "if ls --hyperlink=auto / >/dev/null 2>&1; then",
  "  alias l='ls --hyperlink=auto -la'",
  "else",
  "  l() {",
  "    local _args=\"\" _nondash=0",
  "    for _a in \"$@\"; do",
  "      case \"$_a\" in -*) _args=\"$_args $_a\";; *) _nondash=$((_nondash+1));; esac",
  "    done",
  "    if [ \"$_nondash\" -le 1 ]; then",
  "      local _d=\"\"",
  "      for _a in \"$@\"; do case \"$_a\" in -*) ;; *) _d=\"$_a\";; esac; done",
  "      [ -z \"$_d\" ] && _d=\".\"",
  "      local _abs",
  "      _abs=$(cd \"$_d\" 2>/dev/null && pwd -P) || { ls -la \"$@\"; return; }",
  "      ls -la $_args \"$_d\" | awk -v dir=\"$_abs\" '",
  "        /^$/ { print; next }",
  "        /^total / { print; next }",
  "        /^d/ { print; next }",
  "        /^[lcbps-]/ {",
  "          if (match($0, /^[^ ]+ +[0-9]+ +[^ ]+ +[^ ]+ +[0-9,]+ +[A-Za-z]+ +[0-9]+ +[0-9:]+/)) {",
  "            pre = substr($0, 1, RLENGTH)",
  "            rest = substr($0, RLENGTH + 1)",
  "            sub(/^ +/, \" \", rest)",
  "            fname = substr(rest, 2)",
  "            if (fname == \".\" || fname == \"..\") { print; next }",
  "            link_target = \"\"",
  "            if (index(fname, \" -> \") > 0) {",
  "              idx = index(fname, \" -> \")",
  "              link_target = substr(fname, idx)",
  "              fname = substr(fname, 1, idx - 1)",
  "            }",
  "            fpath = dir \"/\" fname",
  "            gsub(/ /, \"%20\", fpath)",
  "            gsub(/\\(/, \"%28\", fpath)",
  "            gsub(/\\)/, \"%29\", fpath)",
  "            printf \"%s \\033]8;;file://%s\\033\\\\%s\\033]8;;\\033\\\\%s\\n\", pre, fpath, fname, link_target",
  "            next",
  "          }",
  "          print; next",
  "        }",
  "        { print }",
  "      '",
  "    else",
  "      local _pwd",
  "      _pwd=$(pwd -P)",
  "      ls -la $_args \"$@\" | awk -v dir=\"$_pwd\" '",
  "        /^$/ { print; next }",
  "        /^total / { print; next }",
  "        /^d/ { print; next }",
  "        /^[lcbps-]/ {",
  "          if (match($0, /^[^ ]+ +[0-9]+ +[^ ]+ +[^ ]+ +[0-9,]+ +[A-Za-z]+ +[0-9]+ +[0-9:]+/)) {",
  "            pre = substr($0, 1, RLENGTH)",
  "            rest = substr($0, RLENGTH + 1)",
  "            sub(/^ +/, \" \", rest)",
  "            fname = substr(rest, 2)",
  "            if (fname == \".\" || fname == \"..\") { print; next }",
  "            link_target = \"\"",
  "            if (index(fname, \" -> \") > 0) {",
  "              idx = index(fname, \" -> \")",
  "              link_target = substr(fname, idx)",
  "              fname = substr(fname, 1, idx - 1)",
  "            }",
  "            if (substr(fname, 1, 1) == \"/\") { fpath = fname } else { fpath = dir \"/\" fname }",
  "            gsub(/ /, \"%20\", fpath)",
  "            gsub(/\\(/, \"%28\", fpath)",
  "            gsub(/\\)/, \"%29\", fpath)",
  "            printf \"%s \\033]8;;file://%s\\033\\\\%s\\033]8;;\\033\\\\%s\\n\", pre, fpath, fname, link_target",
  "            next",
  "          }",
  "          print; next",
  "        }",
  "        { print }",
  "      '",
  "    fi",
  "  }",
  "fi",
];

/**
 * Build a shell integration snippet for the given preferences.
 * Includes shell hooks (title, OSC 133) and the `l` command for file links.
 * Wrapped in stty -echo/echo to hide the setup from the terminal.
 * Returns a string to send to the PTY, or null if nothing is enabled.
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

  const shellHooks = `if [ -n "$ZSH_VERSION" ]; then ${zsh}; elif [ -n "$BASH_VERSION" ]; then ${bash}; fi`;
  const lsSetup = buildLsSetupOneLiner();

  // stty -echo hides the setup commands from the terminal output
  return `stty -echo\n${shellHooks}\n${lsSetup}\nstty echo`;
}

/**
 * Build a shell command that permanently installs shell integration hooks
 * and the `l` command into the user's rc file (~/.bashrc or ~/.zshrc).
 *
 * Always installs both title and OSC 133 hooks (the full experience),
 * plus the `l` command for clickable file links.
 *
 * Idempotent: checks for existing marker before writing.
 * Wrapped in stty -echo/echo to hide the setup from the terminal.
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
    ...L_FUNCTION_RC_LINES,
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
    ...L_FUNCTION_RC_LINES,
  ];

  // printf '%s\n' 'line1' 'line2' ... writes each line followed by newline
  const zshPrintf = "printf '%s\\n' " + zshLines.map(sq).join(' ');
  const bashPrintf = "printf '%s\\n' " + bashLines.map(sq).join(' ');

  // Single-line command: detect shell → check marker → write via printf → source
  const install = [
    "if [ -n \"$ZSH_VERSION\" ]; then __f=~/.zshrc;",
    "elif [ -n \"$BASH_VERSION\" ]; then __f=~/.bashrc;",
    "else printf '\\n\\033[1;31m%s\\033[0m\\n\\n' 'aiTerm: unsupported shell'; false; fi",
    "&& if ! grep -q '# aiterm-shell-integration' \"$__f\" 2>/dev/null; then",
    "{ if [ -n \"$ZSH_VERSION\" ]; then " + zshPrintf + ";",
    "else " + bashPrintf + "; fi; } >> \"$__f\"",
    "&& . \"$__f\" && printf '\\n\\033[1;32m%s\\033[0m\\n\\n' \"aiTerm: installed in $__f\";",
    "else printf '\\n\\033[1;33m%s\\033[0m\\n\\n' \"aiTerm: already installed in $__f\"; fi",
  ].join(' ');

  // stty -echo hides the long printf commands from the terminal
  return `stty -echo\n${install}\nstty echo`;
}
