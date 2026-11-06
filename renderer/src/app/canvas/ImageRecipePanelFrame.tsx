import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { IconSymbol, type IconName } from "../components/IconSymbol";

type Rect = { left: number; top: number; width: number; height: number };

/** 与节点之间留一档呼吸，贴住媒体卡边缘反而不像浮层。 */
const PANEL_GAP = 12;
const PANEL_MARGIN = 12;

/**
 * 机位与打光面板住在画布浮层根节点上：面板比节点宽得多也高得多，
 * 留在节点里会被媒体卡的 overflow 裁掉，所以统一从这里 portal 出去，
 * 再按锚点矩形的屏幕位置决定落在节点右侧还是左侧。
 */
function panelPlacement(anchor: Rect, host: { width: number; height: number }, preferred: { width: number; height: number }) {
  const width = Math.max(280, Math.min(preferred.width, host.width - PANEL_MARGIN * 2));
  const height = Math.max(220, Math.min(preferred.height, host.height - PANEL_MARGIN * 2));
  const right = anchor.left + anchor.width + PANEL_GAP;
  const fitsRight = right + width <= host.width - PANEL_MARGIN;
  const left = fitsRight ? right : anchor.left - PANEL_GAP - width;
  const top = Math.max(PANEL_MARGIN, Math.min(host.height - height - PANEL_MARGIN, anchor.top));
  return {
    left: Math.max(PANEL_MARGIN, Math.min(host.width - width - PANEL_MARGIN, left)),
    top,
    width,
    height,
  };
}

export function ImageRecipePanelFrame({
  title,
  icon,
  closeLabel,
  width,
  height,
  root,
  anchorRef,
  onClose,
  children,
}: {
  title: string;
  icon: IconName;
  closeLabel: string;
  width: number;
  height: number;
  root: HTMLElement | null;
  anchorRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const [anchor, setAnchor] = useState<Rect>({ left: 0, top: 0, width: 0, height: 0 });
  const [hostSize, setHostSize] = useState({ width: 0, height: 0 });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const anchorElement = anchorRef.current;
    const host = root;
    if (!anchorElement || !host) return;
    const update = () => {
      const anchorRect = anchorElement.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      setAnchor({
        left: anchorRect.left - hostRect.left,
        top: anchorRect.top - hostRect.top,
        width: anchorRect.width,
        height: anchorRect.height,
      });
      setHostSize({ width: hostRect.width, height: hostRect.height });
    };
    update();
    // 画布拖拽与缩放不触发 resize，只能逐帧跟随视口，面板才不会和节点脱开。
    let frame = requestAnimationFrame(function sync() {
      update();
      frame = requestAnimationFrame(sync);
    });
    return () => cancelAnimationFrame(frame);
  }, [anchorRef, root]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  if (!root) return null;
  const placement = panelPlacement(anchor, hostSize, { width, height });
  return createPortal(
    <section
      className="image-recipe-panel nodrag nopan nowheel"
      role="dialog"
      aria-label={title}
      style={placement}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      // 面板在 DOM 上挂在画布浮层，但 React 树仍在图片预览里；不拦住双击，
      // 连续点面板按钮会被预览的 onDoubleClick 当成"看大图"。
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <header className="image-recipe-head">
        <span className="image-recipe-head-icon"><IconSymbol name={icon} /></span>
        <strong>{title}</strong>
        <button type="button" className="image-recipe-close" aria-label={closeLabel} onClick={onClose}>
          <IconSymbol name="x" />
        </button>
      </header>
      {children}
    </section>,
    root,
  );
}
