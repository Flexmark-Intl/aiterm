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
]);

/** Well-known extensionless filenames */
const KNOWN_FILENAMES = new Set([
  'Makefile', 'Dockerfile', 'Containerfile', 'Vagrantfile', 'Procfile',
  'Gemfile', 'Rakefile', 'Brewfile', 'Justfile', 'Taskfile',
  'LICENSE', 'LICENCE', 'COPYING', 'AUTHORS', 'CONTRIBUTORS',
  'CHANGELOG', 'CHANGES', 'HISTORY', 'NEWS',
  'README', 'INSTALL', 'TODO', 'HACKING',
  'CMakeLists.txt', // has extension but commonly referenced
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
  // Paths with / are likely files/dirs even without extensions (e.g. src/utils, ./run-tests)
  if (path.includes('/')) return true;
  return false;
}

/**
 * Regex patterns to match file paths in terminal output.
 * Order matters — more specific patterns first.
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
 * Uses xterm's registerLinkProvider API.
 */
export function createFilePathLinkProvider(
  terminal: Terminal,
  onActivate: (path: string) => void,
): { dispose: () => void } {
  const provider: ILinkProvider = {
    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void) {
      const buffer = terminal.buffer.active;
      const line = buffer.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }

      const text = line.translateToString(false);

      // Skip directory lines in ls -l output (permissions start with 'd')
      if (/^\s*d[rwxsStT@+.\-]{2,9}\s/.test(text)) {
        callback(undefined);
        return;
      }

      const links: ILink[] = [];
      const seen = new Set<string>(); // avoid duplicate links at same position

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
