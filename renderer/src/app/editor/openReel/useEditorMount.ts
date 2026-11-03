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
      if (path.some(item => item.matches('button, input, textarea, select, a, [role="button"], [role="slider"], [role="menu"], [role="menuitem"], [contenteditable="true"], .nodrag'))) return false;
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
      const parent = expanded ? surface : canvas;
      if (parent && mount.parentElement !== parent) {
        parent.appendChild(mount);
      }
      mount.className = expanded ? "ov-editor-mount is-expanded" : "ov-editor-mount is-canvas";
      if (expanded) {
        mount.removeAttribute("style");
        mount.firstElementChild?.removeAttribute("style");
        setActive(true);
      } else if (anchor && canvas) {
        const box = anchor.getBoundingClientRect();
        const bounds = canvas.getBoundingClientRect();
        const zoom = box.width / (anchor.offsetWidth || 1);
        const floating = clipNodePreviewHeight(anchor.offsetWidth);
        const geometry = `${box.x},${box.y},${box.width},${box.height},${bounds.x},${bounds.y},${zoom},${selected},${Boolean(mount.firstElementChild)}`;
        if (previous !== geometry) {
          previous = geometry;
          Object.assign(mount.style, {
            left: `${box.left - bounds.left}px`, top: `${box.top - bounds.top - floating * zoom}px`,
            width: `${box.width}px`, height: `${box.height + floating * zoom}px`,
            // The editor is outside React Flow's DOM. Leave the title band
            // unpainted and unhittable so native node dragging reaches it.
            clipPath: selected
              ? `polygon(0 0, 100% 0, 100% ${(floating - CLIP_NODE_LAYOUT.previewGap) * zoom}px, 0 ${(floating - CLIP_NODE_LAYOUT.previewGap) * zoom}px, 0 ${floating * zoom}px, 100% ${floating * zoom}px, 100% 100%, 0 100%)`
              : `inset(${floating * zoom}px 0 0 0)`,
            zIndex: selected ? "80" : "2",
          });
          const section = mount.firstElementChild as HTMLElement | null;
          if (section) Object.assign(section.style, {
            width: `${box.width / zoom}px`, height: `${box.height / zoom + floating}px`,
            // Keep the embedded editor's logical size stable while the whole
            // canvas node follows the viewport's semantic scale.
            zoom: "1", transform: `scale(${zoom})`, transformOrigin: "top left",
          });
        }
        setActive(selected);
      }
    };
    // Size changes must also synchronize while a background WebView suspends
    // animation frames. Keep the frame loop for canvas pan/zoom transforms.
    const observer = new ResizeObserver(update);
    const anchor = nodeId ? document.querySelector<HTMLElement>(`[data-clip-node-id="${CSS.escape(nodeId)}"]`) : null;
    if (anchor) observer.observe(anchor);
    observer.observe(surface);
    const placement = new MutationObserver(update);
    for (const element of [anchor?.parentElement, anchor?.closest(".react-flow__node"), anchor?.closest(".react-flow__viewport")]) {
      if (element) placement.observe(element, { attributes: true, attributeFilter: ["style"] });
    }
    const tick = () => {
      update();
      frame = requestAnimationFrame(tick);
    };
    update();
    frame = requestAnimationFrame(tick);
    return () => {
      observer.disconnect();
      placement.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [expanded, mount, nodeId, selected, surface]);
  useLayoutEffect(() => () => mount.remove(), [mount]);
  return { mount, active };
}
