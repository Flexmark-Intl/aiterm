import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';
import type { Theme } from '$lib/themes';

/** Parse a hex color to [r, g, b] (0-255) */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

/** Relative luminance (0 = black, 1 = white) */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Mix two hex colors: amount (0-1) of color A into color B */
function mixHex(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const r = Math.round(ar * amount + br * (1 - amount));
  const g = Math.round(ag * amount + bg * (1 - amount));
  const bl = Math.round(ab * amount + bb * (1 - amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

/** Build a CodeMirror 6 theme + syntax highlighting from an aiTerm Theme */
export function buildEditorExtension(theme: Theme): Extension[] {
  const ui = theme.ui;
  const t = theme.terminal;
  const isDark = luminance(ui.bg_dark) < 0.2;

  const selection = mixHex(ui.accent, ui.bg_dark, 0.25);
  const lineHighlight = mixHex(ui.bg_medium, ui.bg_dark, 0.3);
  const searchMatch = mixHex(ui.accent, ui.bg_dark, 0.2);
  const searchMatchSelected = mixHex(ui.accent, ui.bg_dark, 0.4);
  const bracketMatch = mixHex(ui.accent, ui.bg_dark, 0.25);

  const editorTheme = EditorView.theme({
    '&': {
      color: ui.fg,
      backgroundColor: ui.bg_dark,
    },
    '.cm-content': {
      caretColor: ui.fg,
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: ui.fg,
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: selection,
    },
    '.cm-panels': {
      backgroundColor: ui.bg_medium,
      color: ui.fg,
    },
    '.cm-panels.cm-panels-top': {
      borderBottom: `1px solid ${ui.bg_light}`,
    },
    '.cm-panels.cm-panels-bottom': {
      borderTop: `1px solid ${ui.bg_light}`,
    },
    '.cm-searchMatch': {
      backgroundColor: searchMatch,
      outline: `1px solid ${mixHex(ui.accent, ui.bg_dark, 0.4)}`,
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: searchMatchSelected,
    },
    '.cm-activeLine': {
      backgroundColor: lineHighlight,
    },
    '.cm-selectionMatch': {
      backgroundColor: mixHex(ui.accent, ui.bg_dark, 0.15),
    },
    '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
      backgroundColor: bracketMatch,
      outline: `1px solid ${mixHex(ui.accent, ui.bg_dark, 0.5)}`,
    },
    '.cm-gutters': {
      backgroundColor: ui.bg_dark,
      color: ui.fg_dim,
      borderRight: `1px solid ${ui.bg_light}`,
    },
    '.cm-activeLineGutter': {
      backgroundColor: lineHighlight,
      color: ui.fg,
    },
    '.cm-foldPlaceholder': {
      backgroundColor: ui.bg_medium,
      color: ui.fg_dim,
      border: 'none',
    },
    '.cm-tooltip': {
      backgroundColor: ui.bg_medium,
      border: `1px solid ${ui.bg_light}`,
      color: ui.fg,
    },
    '.cm-tooltip .cm-tooltip-arrow:before': {
      borderTopColor: ui.bg_light,
      borderBottomColor: ui.bg_light,
    },
    '.cm-tooltip .cm-tooltip-arrow:after': {
      borderTopColor: ui.bg_medium,
      borderBottomColor: ui.bg_medium,
    },
    '.cm-tooltip-autocomplete': {
      '& > ul > li[aria-selected]': {
        backgroundColor: selection,
      },
    },
  }, { dark: isDark });

  const highlighting = syntaxHighlighting(HighlightStyle.define([
    { tag: tags.keyword, color: ui.magenta },
    { tag: [tags.name, tags.deleted, tags.character, tags.propertyName, tags.macroName], color: ui.fg },
    { tag: [tags.function(tags.variableName), tags.labelName], color: ui.accent },
    { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: t.yellow },
    { tag: [tags.definition(tags.name), tags.separator], color: ui.fg },
    { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: ui.yellow },
    { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link, tags.special(tags.string)], color: ui.cyan },
    { tag: [tags.meta, tags.comment], color: ui.fg_dim, fontStyle: 'italic' },
    { tag: tags.strong, fontWeight: 'bold' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: tags.link, color: ui.cyan, textDecoration: 'underline' },
    { tag: tags.heading, fontWeight: 'bold', color: ui.accent },
    { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: t.yellow },
    { tag: [tags.processingInstruction, tags.string, tags.inserted], color: ui.green },
    { tag: tags.invalid, color: ui.red },
  ]));

  return [editorTheme, highlighting];
}

