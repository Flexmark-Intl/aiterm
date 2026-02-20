import type { EditorView } from '@codemirror/view';

export interface EditorRegistryEntry {
  view: EditorView;
  filePath: string;
  isDirty: boolean;
}

// Simple mutable map - not reactive (accessed by reference)
const registry = new Map<string, EditorRegistryEntry>();

export function registerEditor(tabId: string, view: EditorView, filePath: string): void {
  registry.set(tabId, { view, filePath, isDirty: false });
}

export function unregisterEditor(tabId: string): void {
  registry.delete(tabId);
}

export function setEditorDirty(tabId: string, dirty: boolean): void {
  const entry = registry.get(tabId);
  if (entry) entry.isDirty = dirty;
}

export function getEditorByTabId(tabId: string): EditorRegistryEntry | undefined {
  return registry.get(tabId);
}

export function getEditorByFilePath(filePath: string): { tabId: string; entry: EditorRegistryEntry } | undefined {
  for (const [tabId, entry] of registry) {
    if (entry.filePath === filePath) return { tabId, entry };
  }
  return undefined;
}
