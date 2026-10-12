let simpleClipOpener: ((id: string) => void) | null = null;

export function registerSimpleClipEditorOpener(handler: ((id: string) => void) | null) {
  simpleClipOpener = handler;
}

export function openSimpleClipEditor(id: string) {
  simpleClipOpener?.(id);
}
