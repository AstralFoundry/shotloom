/** Convert browser coordinates to a contained editor's coordinates, including canvas zoom. */
export function getEditorLocalRect(element: Element): DOMRect {
  const rect = element.getBoundingClientRect();
  const root = element.closest<HTMLElement>(".clip-studio-root");
  if (!root) return rect;
  const bounds = root.getBoundingClientRect();
  const scaleX = bounds.width ? root.clientWidth / bounds.width : 1;
  const scaleY = bounds.height ? root.clientHeight / bounds.height : 1;
  return new DOMRect(
    (rect.left - bounds.left) * scaleX,
    (rect.top - bounds.top) * scaleY,
    rect.width * scaleX,
    rect.height * scaleY,
  );
}

export function getEditorClientX(event: { clientX: number }): number {
  const root = document.body.closest<HTMLElement>(".clip-studio-root");
  if (!root) return event.clientX;
  const bounds = root.getBoundingClientRect();
  return (event.clientX - bounds.left) * (bounds.width ? root.clientWidth / bounds.width : 1);
}
export function getEditorClientY(event: { clientY: number }): number {
  const root = document.body.closest<HTMLElement>(".clip-studio-root");
  if (!root) return event.clientY;
  const bounds = root.getBoundingClientRect();
  return (event.clientY - bounds.top) * (bounds.height ? root.clientHeight / bounds.height : 1);
}
