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

export function isPdfFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.pdf');
}

const MARKDOWN_EXTS = new Set(['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdx']);

export function isMarkdownFile(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return false;
  return MARKDOWN_EXTS.has(filePath.slice(dot + 1).toLowerCase());
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

/** Helper to wrap a legacy StreamLanguage mode */
async function legacy(langDef: object): Promise<Extension> {
  const { StreamLanguage } = await import('@codemirror/language');
  return StreamLanguage.define(langDef as Parameters<typeof StreamLanguage.define>[0]);
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
      // Legacy StreamLanguage modes — static imports so Vite can bundle them
      case 'shell': {
        const m = await import('@codemirror/legacy-modes/mode/shell');
        return legacy(m.shell);
      }
      case 'toml': {
        const m = await import('@codemirror/legacy-modes/mode/toml');
        return legacy(m.toml);
      }
      case 'ruby': {
        const m = await import('@codemirror/legacy-modes/mode/ruby');
        return legacy(m.ruby);
      }
      case 'perl': {
        const m = await import('@codemirror/legacy-modes/mode/perl');
        return legacy(m.perl);
      }
      case 'lua': {
        const m = await import('@codemirror/legacy-modes/mode/lua');
        return legacy(m.lua);
      }
      case 'r': {
        const m = await import('@codemirror/legacy-modes/mode/r');
        return legacy(m.r);
      }
      case 'julia': {
        const m = await import('@codemirror/legacy-modes/mode/julia');
        return legacy(m.julia);
      }
      case 'erlang': {
        const m = await import('@codemirror/legacy-modes/mode/erlang');
        return legacy(m.erlang);
      }
      case 'haskell': {
        const m = await import('@codemirror/legacy-modes/mode/haskell');
        return legacy(m.haskell);
      }
      case 'clojure': {
        const m = await import('@codemirror/legacy-modes/mode/clojure');
        return legacy(m.clojure);
      }
      case 'elm': {
        const m = await import('@codemirror/legacy-modes/mode/elm');
        return legacy(m.elm);
      }
      case 'ocaml': {
        const m = await import('@codemirror/legacy-modes/mode/mllike');
        return legacy(m.oCaml);
      }
      case 'fsharp': {
        const m = await import('@codemirror/legacy-modes/mode/mllike');
        return legacy(m.fSharp);
      }
      case 'groovy': {
        const m = await import('@codemirror/legacy-modes/mode/groovy');
        return legacy(m.groovy);
      }
      case 'swift': {
        const m = await import('@codemirror/legacy-modes/mode/swift');
        return legacy(m.swift);
      }
      case 'kotlin': {
        const m = await import('@codemirror/legacy-modes/mode/clike');
        return legacy(m.kotlin);
      }
      case 'scala': {
        const m = await import('@codemirror/legacy-modes/mode/clike');
        return legacy(m.scala);
      }
      case 'csharp': {
        const m = await import('@codemirror/legacy-modes/mode/clike');
        return legacy(m.csharp);
      }
      case 'dart': {
        const m = await import('@codemirror/legacy-modes/mode/clike');
        return legacy(m.dart);
      }
      case 'powershell': {
        const m = await import('@codemirror/legacy-modes/mode/powershell');
        return legacy(m.powerShell);
      }
      case 'dockerfile': {
        const m = await import('@codemirror/legacy-modes/mode/dockerfile');
        return legacy(m.dockerFile);
      }
      case 'protobuf': {
        const m = await import('@codemirror/legacy-modes/mode/protobuf');
        return legacy(m.protobuf);
      }
      case 'diff': {
        const m = await import('@codemirror/legacy-modes/mode/diff');
        return legacy(m.diff);
      }
      case 'cmake': {
        const m = await import('@codemirror/legacy-modes/mode/cmake');
        return legacy(m.cmake);
      }
      case 'octave': {
        const m = await import('@codemirror/legacy-modes/mode/octave');
        return legacy(m.octave);
      }
      case 'pascal': {
        const m = await import('@codemirror/legacy-modes/mode/pascal');
        return legacy(m.pascal);
      }
      case 'verilog': {
        const m = await import('@codemirror/legacy-modes/mode/verilog');
        return legacy(m.verilog);
      }
      case 'vhdl': {
        const m = await import('@codemirror/legacy-modes/mode/vhdl');
        return legacy(m.vhdl);
      }
      case 'tcl': {
        const m = await import('@codemirror/legacy-modes/mode/tcl');
        return legacy(m.tcl);
      }
      case 'd': {
        const m = await import('@codemirror/legacy-modes/mode/d');
        return legacy(m.d);
      }
      case 'nginx': {
        const m = await import('@codemirror/legacy-modes/mode/nginx');
        return legacy(m.nginx);
      }
      case 'properties': {
        const m = await import('@codemirror/legacy-modes/mode/properties');
        return legacy(m.properties);
      }
      case 'latex': {
        const m = await import('@codemirror/legacy-modes/mode/stex');
        return legacy(m.stex);
      }
      case 'coffeescript': {
        const m = await import('@codemirror/legacy-modes/mode/coffeescript');
        return legacy(m.coffeeScript);
      }
      case 'fortran': {
        const m = await import('@codemirror/legacy-modes/mode/fortran');
        return legacy(m.fortran);
      }
      case 'elixir': {
        // Crystal has close enough syntax highlighting
        const m = await import('@codemirror/legacy-modes/mode/crystal');
        return legacy(m.crystal);
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
