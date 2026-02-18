import type { Extension } from '@codemirror/state';

/** Extensionless filenames that are known shell scripts */
const SHELL_FILENAMES = new Set([
  '.bashrc', '.bash_profile', '.bash_login', '.bash_logout', '.bash_aliases',
  '.zshrc', '.zshenv', '.zprofile', '.zlogin', '.zlogout',
  '.profile', '.login', '.logout',
  '.kshrc', '.cshrc', '.tcshrc',
  '.inputrc', '.dircolors',
]);

const EXT_MAP: Record<string, string> = {
  // JavaScript/TypeScript
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  // Web
  html: 'html', htm: 'html', svelte: 'html',
  css: 'css', scss: 'css', less: 'css',
  // Data
  json: 'json', jsonc: 'json',
  yaml: 'yaml', yml: 'yaml',
  xml: 'xml', svg: 'xml', xsl: 'xml',
  // Systems
  rs: 'rust',
  c: 'cpp', h: 'cpp', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hxx: 'cpp',
  java: 'java',
  // Scripting
  py: 'python', pyw: 'python', pyi: 'python',
  // Markup
  md: 'markdown', mdx: 'markdown',
  // Database
  sql: 'sql',
  // Shell
  sh: 'shell', bash: 'shell', zsh: 'shell',
  // Config
  toml: 'toml',
  ini: 'ini', cfg: 'ini',
};

export function extensionToLanguageId(ext: string): string | null {
  return EXT_MAP[ext.toLowerCase()] ?? null;
}

export function detectLanguageFromPath(filePath: string): string | null {
  const fileName = filePath.includes('/') ? filePath.split('/').pop()! : filePath;
  // Check known shell dotfiles first
  if (SHELL_FILENAMES.has(fileName)) return 'shell';
  const dot = fileName.lastIndexOf('.');
  if (dot === -1) return null;
  const ext = fileName.slice(dot + 1);
  return extensionToLanguageId(ext);
}

/** Detect language from file content (e.g. shebang lines) */
export function detectLanguageFromContent(content: string): string | null {
  const firstLine = content.slice(0, content.indexOf('\n')).trim();
  if (/^#!.*\b(bash|sh|zsh|ksh|fish)\b/.test(firstLine)) return 'shell';
  if (/^#!.*\bpython/.test(firstLine)) return 'python';
  if (/^#!.*\b(node|deno|bun)\b/.test(firstLine)) return 'javascript';
  if (/^#!.*\bruby\b/.test(firstLine)) return 'ruby';
  if (/^#!.*\bperl\b/.test(firstLine)) return 'perl';
  return null;
}

export async function loadLanguageExtension(langId: string): Promise<Extension | null> {
  try {
    switch (langId) {
      case 'javascript':
      case 'typescript': {
        const { javascript } = await import('@codemirror/lang-javascript');
        return javascript({ jsx: true, typescript: langId === 'typescript' });
      }
      case 'python': {
        const { python } = await import('@codemirror/lang-python');
        return python();
      }
      case 'rust': {
        const { rust } = await import('@codemirror/lang-rust');
        return rust();
      }
      case 'html': {
        const { html } = await import('@codemirror/lang-html');
        return html();
      }
      case 'css': {
        const { css } = await import('@codemirror/lang-css');
        return css();
      }
      case 'json': {
        const { json } = await import('@codemirror/lang-json');
        return json();
      }
      case 'markdown': {
        const { markdown } = await import('@codemirror/lang-markdown');
        return markdown();
      }
      case 'cpp': {
        const { cpp } = await import('@codemirror/lang-cpp');
        return cpp();
      }
      case 'java': {
        const { java } = await import('@codemirror/lang-java');
        return java();
      }
      case 'yaml': {
        const { yaml } = await import('@codemirror/lang-yaml');
        return yaml();
      }
      case 'xml': {
        const { xml } = await import('@codemirror/lang-xml');
        return xml();
      }
      case 'sql': {
        const { sql } = await import('@codemirror/lang-sql');
        return sql();
      }
      case 'shell': {
        const { StreamLanguage } = await import('@codemirror/language');
        const { shell } = await import('@codemirror/legacy-modes/mode/shell');
        return StreamLanguage.define(shell);
      }
      case 'toml': {
        const { StreamLanguage } = await import('@codemirror/language');
        const { toml } = await import('@codemirror/legacy-modes/mode/toml');
        return StreamLanguage.define(toml);
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
