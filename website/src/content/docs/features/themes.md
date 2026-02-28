---
title: Themes
description: 10 built-in themes plus custom theme support with separate UI and terminal colors.
---

aiTerm ships with 10 built-in themes and supports fully custom themes.

## Built-in Themes

1. **Tokyo Night** (default)
2. **Dracula**
3. **Solarized Dark**
4. **Solarized Light**
5. **Nord**
6. **Gruvbox Dark**
7. **Monokai**
8. **Catppuccin Mocha**
9. **One Dark**
10. **macOS Pro**

## Custom Themes

Create and edit custom themes via the theme editor in Preferences. Each theme has two parts:

### UI Colors

CSS variables that control the application interface:

| Variable | Purpose |
|----------|---------|
| `--bg-dark` | Main background |
| `--bg-medium` | Elevated surfaces |
| `--bg-light` | Borders, hover states |
| `--fg` | Primary text |
| `--fg-dim` | Secondary text |
| `--accent` | Interactive elements |

### Terminal Colors

Full ANSI 16-color palette plus cursor and selection colors. These are applied directly to the xterm.js terminal instance.

## How Themes Work

Themes are defined in `src/lib/themes/index.ts`. When applied:

1. UI colors are set as CSS custom properties on `document.documentElement`
2. Terminal colors are applied to each xterm.js instance
3. The CodeMirror editor uses a matching Tokyo Night theme
