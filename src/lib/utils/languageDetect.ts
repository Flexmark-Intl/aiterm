import type { Extension } from '@codemirror/state';

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  avif: 'image/avif',
};

export function isImageFile(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return false;
  return filePath.slice(dot + 1).toLowerCase() in IMAGE_MIME;
}

export function getImageMimeType(filePath: string): string | null {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return null;
  return IMAGE_MIME[filePath.slice(dot + 1).toLowerCase()] ?? null;
}

/** Extensionless filenames that are known shell scripts */
const SHELL_FILENAMES = new Set([
  '.bashrc', '.bash_profile', '.bash_login', '.bash_logout', '.bash_aliases',
  '.zshrc', '.zshenv', '.zprofile', '.zlogin', '.zlogout',
  '.profile', '.login', '.logout',
  '.kshrc', '.cshrc', '.tcshrc',
  '.inputrc', '.dircolors',
]);

/** Map known filenames (without extensions) to language IDs */
const FILENAME_MAP: Record<string, string> = {
  'Dockerfile': 'dockerfile',
  'Containerfile': 'dockerfile',
  'Makefile': 'shell',
  'CMakeLists.txt': 'cmake',
  'Gemfile': 'ruby',
  'Rakefile': 'ruby',
  'Vagrantfile': 'ruby',
};

const EXT_MAP: Record<string, string> = {
  // JavaScript/TypeScript
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  // Web
  html: 'html', htm: 'html', svelte: 'html', vue: 'vue',
  css: 'css', scss: 'sass', less: 'less',
  sass: 'sass',
  // PHP
  php: 'php', phtml: 'php', php3: 'php', php4: 'php', php5: 'php', phps: 'php',
  // Data
  json: 'json', jsonc: 'json', json5: 'json',
  yaml: 'yaml', yml: 'yaml',
  xml: 'xml', xsl: 'xml', xslt: 'xml', xsd: 'xml', dtd: 'xml', plist: 'xml',
  // Systems
  rs: 'rust',
  go: 'go', mod: 'go',
  c: 'cpp', h: 'cpp', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hxx: 'cpp',
  java: 'java',
  cs: 'csharp',
  swift: 'swift',
  kt: 'kotlin', kts: 'kotlin',
  scala: 'scala',
  // Scripting
  py: 'python', pyw: 'python', pyi: 'python',
  rb: 'ruby', erb: 'ruby', gemspec: 'ruby',
  pl: 'perl', pm: 'perl',
  lua: 'lua',
  r: 'r', R: 'r',
  jl: 'julia',
  ex: 'elixir', exs: 'elixir',
  erl: 'erlang', hrl: 'erlang',
  hs: 'haskell', lhs: 'haskell',
  clj: 'clojure', cljs: 'clojure', cljc: 'clojure', edn: 'clojure',
  elm: 'elm',
  ml: 'ocaml', mli: 'ocaml',
  fs: 'fsharp', fsx: 'fsharp', fsi: 'fsharp',
  groovy: 'groovy', gradle: 'groovy',
  dart: 'dart',
  // Markup
  md: 'markdown', mdx: 'markdown',
  tex: 'latex', sty: 'latex', cls: 'latex',
  rst: 'restructuredtext',
  // Database
  sql: 'sql',
  // Shell
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  // Config
  toml: 'toml',
  ini: 'ini', cfg: 'ini',
  properties: 'properties',
  // DevOps / infrastructure
  dockerfile: 'dockerfile',
  tf: 'hcl', hcl: 'hcl',
  proto: 'protobuf',
  // WebAssembly
  wat: 'wast', wast: 'wast',
  // Other
  diff: 'diff', patch: 'diff',
  cmake: 'cmake',
  m: 'octave', // MATLAB/Octave
  pas: 'pascal', pp: 'pascal',
  v: 'verilog', sv: 'verilog',
  vhd: 'vhdl', vhdl: 'vhdl',
  tcl: 'tcl',
  nim: 'nim',
  zig: 'zig',
  d: 'd',
  // Nginx
  nginx: 'nginx', conf: 'nginx',
};

export function extensionToLanguageId(ext: string): string | null {
  return EXT_MAP[ext.toLowerCase()] ?? null;
}

export function detectLanguageFromPath(filePath: string): string | null {
  const fileName = filePath.includes('/') ? filePath.split('/').pop()! : filePath;
  if (SHELL_FILENAMES.has(fileName)) return 'shell';
  if (FILENAME_MAP[fileName]) return FILENAME_MAP[fileName];
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

/** Helper to load a legacy StreamLanguage mode */
async function legacy(mode: string, exportName?: string): Promise<Extension | null> {
  const { StreamLanguage } = await import('@codemirror/language');
  const mod = await import(`@codemirror/legacy-modes/mode/${mode}`);
  const lang = mod[exportName ?? mode];
  return lang ? StreamLanguage.define(lang) : null;
}

export async function loadLanguageExtension(langId: string): Promise<Extension | null> {
  try {
    switch (langId) {
      // First-class CodeMirror 6 packages
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
      case 'php': {
        const { php } = await import('@codemirror/lang-php');
        return php();
      }
      case 'go': {
        const { go } = await import('@codemirror/lang-go');
        return go();
      }
      case 'sass': {
        const { sass } = await import('@codemirror/lang-sass');
        return sass({ indented: false });
      }
      case 'less': {
        const { less } = await import('@codemirror/lang-less');
        return less();
      }
      case 'vue': {
        const { vue } = await import('@codemirror/lang-vue');
        return vue();
      }
      case 'wast': {
        const { wast } = await import('@codemirror/lang-wast');
        return wast();
      }
      // Legacy StreamLanguage modes
      case 'shell': return legacy('shell');
      case 'toml': return legacy('toml');
      case 'ruby': return legacy('ruby');
      case 'perl': return legacy('perl');
      case 'lua': return legacy('lua');
      case 'r': return legacy('r');
      case 'julia': return legacy('julia');
      case 'erlang': return legacy('erlang');
      case 'haskell': return legacy('haskell');
      case 'clojure': return legacy('clojure');
      case 'elm': return legacy('elm');
      case 'ocaml': return legacy('mllike', 'oCaml');
      case 'fsharp': return legacy('mllike', 'fSharp');
      case 'groovy': return legacy('groovy');
      case 'swift': return legacy('swift');
      case 'kotlin': return legacy('clike', 'kotlin');
      case 'scala': return legacy('clike', 'scala');
      case 'csharp': return legacy('clike', 'csharp');
      case 'dart': return legacy('clike', 'dart');
      case 'powershell': return legacy('powershell');
      case 'dockerfile': return legacy('dockerfile');
      case 'protobuf': return legacy('protobuf');
      case 'diff': return legacy('diff');
      case 'cmake': return legacy('cmake');
      case 'octave': return legacy('octave');
      case 'pascal': return legacy('pascal');
      case 'verilog': return legacy('verilog');
      case 'vhdl': return legacy('vhdl');
      case 'tcl': return legacy('tcl');
      case 'd': return legacy('d');
      case 'nginx': return legacy('nginx');
      case 'properties': return legacy('properties');
      case 'latex': return legacy('stex', 'stex');
      case 'coffeescript': return legacy('coffeescript');
      case 'fortran': return legacy('fortran');
      case 'elixir': return legacy('crystal'); // Close enough syntax highlighting
      default:
        return null;
    }
  } catch {
    return null;
  }
}
