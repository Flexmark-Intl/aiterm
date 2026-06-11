/**
 * GFM table scanner that maps rendered table cells back to exact byte ranges
 * in the markdown source, so a cell can be edited in the rendered view and
 * written back without touching any other byte of the document.
 *
 * The scanner mirrors marked's table tokenizer (verified against marked v17):
 * - header = any non-blank, non-block-start line with <=3 leading spaces whose
 *   cell count equals the delimiter row's cell count (pipes in the header are
 *   not required — single-column tables only need them in the delimiter row)
 * - rows continue through any plain line (even without pipes) and stop at a
 *   blank line, heading, list, blockquote, hr, fence, or HTML block
 * - cells are split on unescaped `|`; `\|` stays part of the cell
 * - tables inside fenced code blocks are ignored
 *
 * Tables marked recognizes in nested contexts (blockquotes, lists) are NOT
 * found by this scanner. Callers must structurally validate a rendered table
 * against the scanned one (column/row counts) before trusting the mapping.
 */

export interface TableCellSpan {
  /** Source offset where the trimmed cell content starts. */
  start: number;
  /** Source offset where the trimmed cell content ends. */
  end: number;
  /** Source text of the trimmed cell content (pipe escapes intact). */
  raw: string;
}

export interface TableSpan {
  /** rows[0] is the header row; the delimiter row is omitted. */
  rows: TableCellSpan[][];
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

// Block starts that terminate a table's row run (mirrors marked's lexer order:
// these tokenizers win over table row continuation).
const BLOCK_STARTS = [
  /^ {0,3}#{1,6}(\s|$)/, // heading
  /^ {0,3}>/, // blockquote
  /^ {0,3}(?:[-*_][ \t]*){3,}$/, // hr
  /^ {0,3}(?:[-*+]|\d{1,9}[.)])\s/, // list item
  FENCE, // code fence
  /^ {0,3}</, // html block
];

function isBlockStart(text: string): boolean {
  return BLOCK_STARTS.some((re) => re.test(text));
}

function isDelimiterRow(text: string): boolean {
  if (!text.includes('|') || /^ {4,}/.test(text)) return false;
  const inner = text.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').every((c) => /^ *:?-+:? *$/.test(c));
}

/** Split one source line into cell content spans (offsets into the full source). */
function splitRowSpans(src: string, lineStart: number, text: string): TableCellSpan[] {
  // Segment boundaries at unescaped pipes
  const segs: Array<[number, number]> = [];
  let segStart = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      i++;
    } else if (ch === '|') {
      segs.push([segStart, i]);
      segStart = i + 1;
    }
  }
  segs.push([segStart, text.length]);

  const isBlank = ([s, e]: [number, number]) => text.slice(s, e).trim() === '';
  // A leading pipe is row decoration, not an empty first cell; same for trailing.
  if (segs.length > 1 && isBlank(segs[0])) segs.shift();
  if (segs.length > 1 && isBlank(segs[segs.length - 1])) segs.pop();

  return segs.map(([s, e]) => {
    let cs = s;
    let ce = e;
    while (cs < ce && (text[cs] === ' ' || text[cs] === '\t')) cs++;
    while (ce > cs && (text[ce - 1] === ' ' || text[ce - 1] === '\t')) ce--;
    return { start: lineStart + cs, end: lineStart + ce, raw: text.slice(cs, ce) };
  });
}

export function scanTables(src: string): TableSpan[] {
  const tables: TableSpan[] = [];
  const lines: Array<{ start: number; text: string }> = [];
  let pos = 0;
  for (const text of src.split('\n')) {
    lines.push({ start: pos, text });
    pos += text.length + 1;
  }

  let inFence = false;
  let fenceChar = '';
  for (let i = 0; i < lines.length; i++) {
    const { start, text } = lines[i];
    const fence = text.match(FENCE);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceChar = fence[1][0];
      } else if (fence[1][0] === fenceChar) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    if (i + 1 >= lines.length) break;
    if (text.trim() === '' || /^ {4,}/.test(text) || isBlockStart(text)) continue;
    if (!isDelimiterRow(lines[i + 1].text)) continue;

    const headerCells = splitRowSpans(src, start, text);
    const delimCells = splitRowSpans(src, lines[i + 1].start, lines[i + 1].text);
    if (headerCells.length !== delimCells.length) continue;

    const rows: TableCellSpan[][] = [headerCells];
    let j = i + 2;
    while (j < lines.length) {
      const row = lines[j].text;
      if (row.trim() === '' || isBlockStart(row)) break;
      rows.push(splitRowSpans(src, lines[j].start, row));
      j++;
    }
    tables.push({ rows });
    i = j - 1; // lines consumed as rows are never re-considered as headers
  }
  return tables;
}

/** Cell source text → text shown while editing (unescape pipes). */
export function displayCellText(raw: string): string {
  return raw.replace(/\\\|/g, '|');
}

/** Edited text → cell source text (escape pipes, collapse newlines). */
export function encodeCellText(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim().replace(/\|/g, '\\|');
}
