/** React portals keep their component ancestry, but their DOM events may originate outside the canvas. */
export function isCanvasDomEvent(event: Event, canvas: EventTarget): boolean {
  return event.composedPath().includes(canvas);
}

/** Inspect the real event path because ShadowRoot retargets chat input events to its host. */
export function isEditableCanvasEvent(event: Event): boolean {
  return event.composedPath().some((target) => target instanceof HTMLElement && (
    target.isContentEditable
    || target.matches('input,textarea,select,[contenteditable="true"],[role="textbox"]')
  ));
}
