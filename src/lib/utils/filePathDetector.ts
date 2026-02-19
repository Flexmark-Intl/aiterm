import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm';

/** Extensions we recognize as files (to reduce false positives) */
const FILE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts',
  'rs', 'py', 'rb', 'go', 'java', 'c', 'cpp', 'h', 'hpp',
  'html', 'htm', 'css', 'scss', 'less', 'svelte', 'vue',
  'json', 'yaml', 'yml', 'toml', 'xml', 'svg',
  'md', 'mdx', 'txt', 'log', 'csv',
  'sql', 'sh', 'bash', 'zsh', 'fish',
  'conf', 'cfg', 'ini', 'env',
  'lock', 'dockerfile', 'makefile',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif',
]);

/** Well-known extensionless filenames */
const KNOWN_FILENAMES = new Set([
  'Makefile', 'Dockerfile', 'Containerfile', 'Vagrantfile', 'Procfile',
  'Gemfile', 'Rakefile', 'Brewfile', 'Justfile', 'Taskfile',
  'LICENSE', 'LICENCE', 'COPYING', 'AUTHORS', 'CONTRIBUTORS',
  'CHANGELOG', 'CHANGES', 'HISTORY', 'NEWS',
  'README', 'INSTALL', 'TODO', 'HACKING',
  'CMakeLists.txt',
  'configure', 'gradlew',
]);

function hasKnownExtension(path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return false;
  const ext = path.slice(dot + 1).toLowerCase();
  return FILE_EXTENSIONS.has(ext);
}

function isDotfile(path: string): boolean {
  const name = path.includes('/') ? path.split('/').pop()! : path;
  return name.startsWith('.') && name.length > 1 && name !== '..';
}

function isKnownFilename(path: string): boolean {
  const name = path.includes('/') ? path.split('/').pop()! : path;
  return KNOWN_FILENAMES.has(name);
}

function isLikelyFile(path: string): boolean {
  if (hasKnownExtension(path)) return true;
  if (isDotfile(path)) return true;
  if (isKnownFilename(path)) return true;
  if (path.includes('/')) return true;
  return false;
}

/**
 * Regex patterns to match file paths in terminal output.
 * Order matters — more specific patterns first.
 *
 * Note: ls -l output is NOT handled here. The `l` shell function emits
 * OSC 8 hyperlinks which xterm.js handles natively via linkHandler.
 */
const FILE_PATH_PATTERNS = [
  // Absolute paths: /foo/bar or ~/foo/bar (with or without extension)
  /(?:^|[\s'"({\[,:])([~\/][\w.\-\/]+)(?=[\s'")\],:;]|$)/,
  // Relative paths: ./foo, ../foo, or dir/file patterns
  /(?:^|[\s'"({\[,:])(\.\.\/.+?|\.\/.+?|[\w][\w.\-]*\/[\w.\-\/]+)(?=[\s'")\],:;]|$)/,
  // Bare filenames with extension: package.json, CHANGELOG.md
  /(?:^|[\s'"({\[,:])([.\w][\w.\-]*\.\w+)(?=[\s'")\],:;]|$)/,
  // Dotfiles without extension: .gitignore, .bashrc, .env
  /(?:^|[\s'"({\[,:])(\.[a-zA-Z][\w.\-]*)(?=[\s'")\],:;]|$)/,
  // Known extensionless filenames: Makefile, Dockerfile, LICENSE
  /(?:^|[\s'"({\[,:])((?:Makefile|Dockerfile|Containerfile|Vagrantfile|Procfile|Gemfile|Rakefile|Brewfile|Justfile|Taskfile|LICENSE|LICENCE|COPYING|AUTHORS|CONTRIBUTORS|CHANGELOG|CHANGES|HISTORY|NEWS|README|INSTALL|TODO|HACKING|configure|gradlew))(?=[\s'")\],:;]|$)/,
];

/**
 * Creates a link provider that detects file paths in terminal output.
 * Handles paths from compiler errors, git status, find, grep, etc.
 *
 * ls -l file linking is handled separately via OSC 8 hyperlinks
 * (the `l` shell function + xterm.js linkHandler).
 */
export function createFilePathLinkProvider(
  terminal: Terminal,
  onActivate: (path: string) => void,
): { dispose: () => void } {
  const provider: ILinkProvider = {
    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void) {
      const line = terminal.buffer.active.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }

      const text = line.translateToString(true);
      const links: ILink[] = [];
      const seen = new Set<string>();

      for (const pattern of FILE_PATH_PATTERNS) {
        const regex = new RegExp(pattern.source, 'g');
        let match: RegExpExecArray | null;

        while ((match = regex.exec(text)) !== null) {
          const filePath = match[1];
          if (!filePath || !isLikelyFile(filePath)) continue;

          const startIndex = match.index + match[0].indexOf(filePath);
          const key = `${startIndex}:${filePath.length}`;
          if (seen.has(key)) continue;
          seen.add(key);

          links.push({
            range: {
              start: { x: startIndex + 1, y: bufferLineNumber },
              end: { x: startIndex + filePath.length + 1, y: bufferLineNumber },
            },
            text: filePath,
            activate: () => onActivate(filePath),
          });
        }
      }

      callback(links.length > 0 ? links : undefined);
    },
  };

  return terminal.registerLinkProvider(provider);
}
