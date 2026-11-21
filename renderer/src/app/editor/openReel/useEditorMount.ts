import { useLayoutEffect, useState } from "react";
import { CLIP_NODE_LAYOUT, clipNodePreviewHeight } from "../../../utils/clipNodeLayout";

/** Keep the same portal container and embedded editor through canvas/editor transitions. */
export function useEditorMount(surface: HTMLElement | null, nodeId?: string, expanded = true, selected = true) {
  const [mount] = useState(() => document.createElement("div"));
  const [active, setActive] = useState(expanded || selected);
  useLayoutEffect(() => {
    if (expanded || !nodeId) return;
    const anchor = () => document.querySelector<HTMLElement>(`[data-clip-node-id="${CSS.escape(nodeId)}"]`);
    const canMove = (event: MouseEvent) => {
      if (event.button !== 0) return false;
      const path = event.composedPath().filter((item): item is HTMLElement => item instanceof HTMLElement);
      // Shadow DOM retargets event.target to the editor host; inspect the real
      // path so timeline gestures and controls keep their existing behavior.
      if (path.some(item => item !== mount && item.matches('button, input, textarea, select, a, [role="button"], [role="slider"], [role="menu"], [role="menuitem"], [contenteditable="true"], .nodrag'))) return false;
      const toolbar = path.some(item => item.matches('.shotloom-canvas-tools'));
      if (!toolbar && path.some(item => item.matches('#editor-panel-timeline, [data-tour="timeline"]'))) return false;
      const node = anchor();
      if (!node) return false;
      const box = node.getBoundingClientRect();
      const zoom = box.width / (node.offsetWidth || 1);
      const previewBottom = box.top - CLIP_NODE_LAYOUT.previewGap * zoom;
      return event.clientY < previewBottom || path.some(item => item.matches('.shotloom-canvas-tools, .ov-openreel-stage, .clip-studio-runtime-host, .clip-studio-root'));
    };
    const pointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && canMove(event)) event.stopPropagation();
    };
    const mouseMove = (event: MouseEvent) => { mount.style.cursor = canMove(event) ? 'grab' : ''; };
    const mouseLeave = () => { mount.style.cursor = ''; };
    const mouseDown = (event: MouseEvent) => {
      if (!canMove(event)) return;
      const handle = anchor()?.closest('.react-flow__node')?.querySelector('.work-node-kicker');
      if (!handle) return;
      event.preventDefault();
      event.stopPropagation();
      // Start React Flow's own drag gesture, preserving selection, zoom,
      // multi-node movement and its normal position persistence.
      handle.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, view: event.view || window,
        clientX: event.clientX, clientY: event.clientY, screenX: event.screenX, screenY: event.screenY,
        button: event.button, buttons: event.buttons,
        shiftKey: event.shiftKey, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
      }));
    };
    mount.addEventListener('pointerdown', pointerDown, true);
    mount.addEventListener('mousedown', mouseDown, true);
    mount.addEventListener('mousemove', mouseMove, true);
    mount.addEventListener('mouseleave', mouseLeave);
    return () => {
      mount.removeEventListener('pointerdown', pointerDown, true);
      mount.removeEventListener('mousedown', mouseDown, true);
      mount.removeEventListener('mousemove', mouseMove, true);
      mount.removeEventListener('mouseleave', mouseLeave);
      mount.style.cursor = '';
    };
  }, [expanded, mount, nodeId]);
  useLayoutEffect(() => {
    if (!surface) return;
    let frame = 0;
    let previous = "";
    const update = () => {
      const anchor = nodeId ? document.querySelector<HTMLElement>(`[data-clip-node-id="${CSS.escape(nodeId)}"]`) : null;
      const canvas = anchor?.closest<HTMLElement>(".react-workflow-canvas");
      // Keep the detached runtime inside its node's stacking context so it
      // follows the same selection/drag order as every other canvas node.
      const nodeRoot = anchor?.closest<HTMLElement>(".react-flow__node");
      const parent = expanded ? surface : nodeRoot;
      if (parent && mount.parentElement !== parent) {
        parent.appendChild(mount);
      }
      // Timeline gestures stay inside the editor; draggable chrome explicitly
      // forwards its gesture to the node label in the listener above.
      mount.className = expanded ? "ov-editor-mount is-expanded" : "ov-editor-mount is-canvas nodrag nopan";
      if (expanded) {
        mount.removeAttribute("style");
        mount.firstElementChild?.removeAttribute("style");
        setActive(true);
      } else if (anchor && canvas && nodeRoot) {
        const box = anchor.getBoundingClientRect();
        const bounds = nodeRoot.getBoundingClientRect();
        const width = anchor.offsetWidth;
        const height = anchor.offsetHeight;
        const zoom = width > 0 ? box.width / width : 0;
        if (zoom <= 0) return;
        const left = (box.left - bounds.left) / zoom;
        const top = (box.top - bounds.top) / zoom;
        const floating = clipNodePreviewHeight(width);
        const geometry = `${left},${top},${width},${height},${selected}`;
        if (previous !== geometry) {
          previous = geometry;
          Object.assign(mount.style, {
            // The portal is already inside the viewport transform.
            left: `${left}px`, top: `${top - floating}px`,
            width: `${width}px`, height: `${height + floating}px`,
            // Leave the title band unpainted and unhittable so native node
            // dragging reaches it, even while the preview is visible.
            clipPath: selected
              ? `polygon(0 0, 100% 0, 100% ${floating - CLIP_NODE_LAYOUT.previewGap}px, 0 ${floating - CLIP_NODE_LAYOUT.previewGap}px, 0 ${floating}px, 100% ${floating}px, 100% 100%, 0 100%)`
              : `inset(${floating}px 0 0 0)`,
            zIndex: "2",
          });
        }
        setActive(selected);
      }
    };
    // Geometry changes are observable: avoid measuring every embedded editor
    // on every display frame, and merge pan / zoom notifications.
    const scheduleUpdate = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };
    // Resize delivery also keeps background WebViews sized when rAF is suspended.
    const observer = new ResizeObserver(update);
    const anchor = nodeId ? document.querySelector<HTMLElement>(`[data-clip-node-id="${CSS.escape(nodeId)}"]`) : null;
    if (anchor) observer.observe(anchor);
    observer.observe(surface);
    const placement = new MutationObserver(scheduleUpdate);
    placement.observe(mount, { childList: true });
    for (const element of [anchor?.parentElement, anchor?.closest(".react-flow__node")]) {
      if (element) placement.observe(element, { attributes: true, attributeFilter: ["style"] });
    }
    update();
    return () => {
      observer.disconnect();
      placement.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [expanded, mount, nodeId, selected, surface]);
  useLayoutEffect(() => () => mount.remove(), [mount]);
  return { mount, active };
}
