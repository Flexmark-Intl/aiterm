import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

const tokyoNight = {
  bg: '#1a1b26',
  bgMedium: '#24283b',
  bgLight: '#414868',
  fg: '#c0caf5',
  fgDim: '#565f89',
  accent: '#7aa2f7',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  orange: '#ff9e64',
  comment: '#565f89',
  selection: '#283457',
  lineHighlight: '#1e2030',
  cursor: '#c0caf5',
};

export const tokyoNightTheme = EditorView.theme({
  '&': {
    color: tokyoNight.fg,
    backgroundColor: tokyoNight.bg,
  },
  '.cm-content': {
    caretColor: tokyoNight.cursor,
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: tokyoNight.cursor,
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: tokyoNight.selection,
  },
  '.cm-panels': {
    backgroundColor: tokyoNight.bgMedium,
    color: tokyoNight.fg,
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: `1px solid ${tokyoNight.bgLight}`,
  },
  '.cm-panels.cm-panels-bottom': {
    borderTop: `1px solid ${tokyoNight.bgLight}`,
  },
  '.cm-searchMatch': {
    backgroundColor: 'rgba(122, 162, 247, 0.2)',
    outline: `1px solid rgba(122, 162, 247, 0.4)`,
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'rgba(122, 162, 247, 0.4)',
  },
  '.cm-activeLine': {
    backgroundColor: tokyoNight.lineHighlight,
  },
  '.cm-selectionMatch': {
    backgroundColor: 'rgba(122, 162, 247, 0.15)',
  },
  '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
    backgroundColor: 'rgba(122, 162, 247, 0.25)',
    outline: '1px solid rgba(122, 162, 247, 0.5)',
  },
  '.cm-gutters': {
    backgroundColor: tokyoNight.bg,
    color: tokyoNight.fgDim,
    borderRight: `1px solid ${tokyoNight.bgLight}`,
  },
  '.cm-activeLineGutter': {
    backgroundColor: tokyoNight.lineHighlight,
    color: tokyoNight.fg,
  },
  '.cm-foldPlaceholder': {
    backgroundColor: tokyoNight.bgMedium,
    color: tokyoNight.fgDim,
    border: 'none',
  },
  '.cm-tooltip': {
    backgroundColor: tokyoNight.bgMedium,
    border: `1px solid ${tokyoNight.bgLight}`,
    color: tokyoNight.fg,
  },
  '.cm-tooltip .cm-tooltip-arrow:before': {
    borderTopColor: tokyoNight.bgLight,
    borderBottomColor: tokyoNight.bgLight,
  },
  '.cm-tooltip .cm-tooltip-arrow:after': {
    borderTopColor: tokyoNight.bgMedium,
    borderBottomColor: tokyoNight.bgMedium,
  },
  '.cm-tooltip-autocomplete': {
    '& > ul > li[aria-selected]': {
      backgroundColor: tokyoNight.selection,
    },
  },
}, { dark: true });

export const tokyoNightHighlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.keyword, color: tokyoNight.magenta },
  { tag: [tags.name, tags.deleted, tags.character, tags.propertyName, tags.macroName], color: tokyoNight.fg },
  { tag: [tags.function(tags.variableName), tags.labelName], color: tokyoNight.blue },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: tokyoNight.orange },
  { tag: [tags.definition(tags.name), tags.separator], color: tokyoNight.fg },
  { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: tokyoNight.yellow },
  { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link, tags.special(tags.string)], color: tokyoNight.cyan },
  { tag: [tags.meta, tags.comment], color: tokyoNight.comment, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: tokyoNight.cyan, textDecoration: 'underline' },
  { tag: tags.heading, fontWeight: 'bold', color: tokyoNight.blue },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: tokyoNight.orange },
  { tag: [tags.processingInstruction, tags.string, tags.inserted], color: tokyoNight.green },
  { tag: tags.invalid, color: tokyoNight.red },
]));

export const tokyoNightExtension = [tokyoNightTheme, tokyoNightHighlighting];
