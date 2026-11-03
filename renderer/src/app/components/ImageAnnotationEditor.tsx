import { t } from '@/i18n';
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type RefObject } from "react";
import ScreenshotsContext from "../../../../node_modules/react-screenshots/lib/Screenshots/ScreenshotsContext.js";
import ScreenshotsCanvas from "../../../../node_modules/react-screenshots/lib/Screenshots/ScreenshotsCanvas/index.js";
import annotationOperations from "../../../../node_modules/react-screenshots/lib/Screenshots/operations/index.js";
import composeImage from "../../../../node_modules/react-screenshots/lib/Screenshots/composeImage.js";
import { HistoryItemType } from "../../../../node_modules/react-screenshots/lib/Screenshots/types.js";
import zhCN from "../../../../node_modules/react-screenshots/lib/Screenshots/zh_CN.js";
import { showToast } from "../../store/notificationStore";
import { IconSymbol } from "./IconSymbol";

export type ImageAnnotation = { id: string; kind: "rect" | "ellipse" | "arrow" | "line" | "pen" | "text" | "annotation" | "mosaic"; points: Array<{ x: number; y: number }>; text?: string; color?: string; strokeWidth?: number };
export type ImageAnnotationSave = { blob: Blob; bounds: { x: number; y: number; width: number; height: number } };

type ContextValue = { store: any; dispatcher: any };

/**
 * 操作条由本项目自己拼接：第三方只交出按钮清单，容器与定位一直由 `canvas.css` 的
 * `.screenshots-operations` 覆盖决定，所以这里不引入它的 ScreenshotsOperations，
 * 才能在末尾接上"标注完成，生成新节点"这颗它没有的按钮。
 */
export function ImageAnnotationEditor({ imageUrl, imageWidth, imageHeight, semanticZoom = 1, root, anchorRef, onCancel, onSave, onCreateNode }: { imageUrl: string; imageWidth: number; imageHeight: number; annotations?: ImageAnnotation[]; semanticZoom?: number; root: HTMLElement | null; anchorRef: RefObject<HTMLDivElement | null>; onCancel: () => void; onSave: (result: ImageAnnotationSave) => void; onCreateNode: (result: ImageAnnotationSave) => void | Promise<void> }) {
  const canvasContextRef = useRef<CanvasRenderingContext2D | null>(null);
  const emitterRef = useRef<Record<string, unknown>>({});
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [history, setHistory] = useState({ index: -1, stack: [] as any[] });
  const [operation, setOperation] = useState<string | undefined>(undefined);
  const [screenRect, setScreenRect] = useState({ left: 0, top: 0, width: imageWidth, height: imageHeight });
  useEffect(() => {
    const updatePosition = () => {
      const anchor = anchorRef.current;
      const host = root;
      if (!anchor || !host) return;
      const anchorRect = anchor.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      setScreenRect({
        left: anchorRect.left - hostRect.left,
        top: anchorRect.top - hostRect.top,
        width: anchorRect.width || imageWidth,
        height: anchorRect.height || imageHeight,
      });
    };
    updatePosition();
    let frame = 0;
    const syncFrame = () => {
      updatePosition();
      frame = requestAnimationFrame(syncFrame);
    };
    frame = requestAnimationFrame(syncFrame);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(updatePosition) : null;
    if (anchorRef.current) observer?.observe(anchorRef.current);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, imageHeight, imageWidth, root, semanticZoom]);
  useEffect(() => {
    document.body.classList.add("annotation-editor-open");
    const finishTextEntry = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !(event.target instanceof HTMLTextAreaElement) || !event.target.classList.contains("screenshots-textarea")) return;
      event.preventDefault();
      event.target.blur();
    };
    document.addEventListener("keydown", finishTextEntry, true);
    let frame = 0;
    const syncOptionPosition = () => {
      const selected = Array.from(document.querySelectorAll<HTMLElement>(
        ".canvas-image-annotation-editor .screenshots-button-checked",
      )).at(-1);
      const option = Array.from(document.querySelectorAll<HTMLElement>(
        "body.annotation-editor-open .screenshots-option",
      )).find((item) => item.getBoundingClientRect().width > 0 && item.getBoundingClientRect().height > 0);
      if (selected && option) {
        const buttonRect = selected.getBoundingClientRect();
        const optionRect = option.getBoundingClientRect();
        const optionWidth = optionRect.width || option.scrollWidth;
        const optionHeight = optionRect.height || option.scrollHeight;
        if (!optionWidth || !optionHeight) {
          frame = requestAnimationFrame(syncOptionPosition);
          return;
        }
        const left = Math.max(8, Math.min(
          window.innerWidth - optionWidth - 8,
          buttonRect.left + buttonRect.width / 2 - optionWidth / 2,
        ));
        const above = buttonRect.top - optionHeight - 12;
        const top = above >= 8 ? above : buttonRect.bottom + 12;
        option.style.setProperty("left", `${left}px`, "important");
        option.style.setProperty("top", `${top}px`, "important");
        option.style.setProperty("visibility", "visible", "important");
      }
      frame = requestAnimationFrame(syncOptionPosition);
    };
    frame = requestAnimationFrame(syncOptionPosition);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", finishTextEntry, true);
      document.body.classList.remove("annotation-editor-open");
    };
  }, []);
  const width = screenRect.width;
  const height = screenRect.height;
  const bounds = useMemo(() => ({ x: 0, y: 0, width, height }), [width, height]);
  useEffect(() => {
    const next = new Image();
    next.onload = () => setImage(next);
    next.src = imageUrl;
    return () => { next.onload = null; };
  }, [imageUrl]);
  const composingRef = useRef(false);
  const [composing, setComposing] = useState(false);
  // 与第三方"完成"按钮同一条合成路径：先把选中态摘掉，否则蓝色选择框会被画进结果里。
  const compose = (deliver: (result: ImageAnnotationSave) => void | Promise<void>) => {
    if (!image || composingRef.current) return;
    composingRef.current = true;
    setComposing(true);
    history.stack.forEach((item: any) => { if (item?.type === HistoryItemType.Source) item.isSelected = false; });
    setHistory({ index: history.index, stack: history.stack });
    window.setTimeout(() => {
      void composeImage({ image, width, height, history, bounds })
        .then((blob) => deliver({ blob, bounds }))
        .catch((cause) => showToast(cause instanceof Error ? cause.message : t("ui.ImageAnnotationEditor.text.a6081340")))
        .finally(() => {
          composingRef.current = false;
          setComposing(false);
        });
    });
  };
  const store = useMemo(() => ({ url: imageUrl, image, width, height, lang: { ...zhCN, operation_text_title: t("ui.canvasMediaActions.suffix.c57f2cf0"), operation_mosaic_title: t("ui.ImageAnnotationEditor.operationmosaictitle.2bd3dcc6"), operation_ellipse_title: t("ui.ImageAnnotationEditor.operationellipsetitle.e0062378"), operation_rectangle_title: t("ui.ImageAnnotationEditor.operationrectangletitle.b5d5ad39"), operation_cancel_title: t("ui.CanvasToolbarCustomizeDialog.arialabel.6c14bd7f"), operation_ok_title: t("ui.ReactWorkbench.text.33246f6a") }, emitterRef, canvasContextRef, history, bounds, cursor: operation ? "crosshair" : "default", operation }), [imageUrl, image, width, height, history, bounds, operation]);
  const dispatcher = useMemo(() => ({ call: (name: string, ...args: unknown[]) => { if (name === "onCancel") onCancel(); if (name === "onSave" || name === "onOk") onSave({ blob: args[0] as Blob, bounds: args[1] as ImageAnnotationSave["bounds"] }); }, setHistory, setBounds: () => undefined, setCursor: () => undefined, setOperation }), [onCancel, onSave]);
  const context = useMemo<ContextValue>(() => ({ store, dispatcher }), [store, dispatcher]);
  if (!root) return null;
  return createPortal(<div className="canvas-image-annotation-editor nodrag nopan nowheel" style={{ left: screenRect.left, top: screenRect.top, width, height, "--canvas-annotation-toolbar-scale": "1", "--canvas-annotation-zoom": String(semanticZoom) } as CSSProperties} onPointerDown={(event) => event.stopPropagation()}>
    <ScreenshotsContext.Provider value={context}>
      {image && <ScreenshotsCanvas ref={canvasContextRef} />}
      {image && <div className="screenshots-operations" onDoubleClick={(event) => event.stopPropagation()} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}>
        <div className="screenshots-operations-buttons">
          {annotationOperations.map((entry, index) => {
            if (entry === "|") return <div className="screenshots-operations-divider" key={`divider-${index}`} />;
            const Operation = entry as ComponentType;
            return <Operation key={`operation-${index}`} />;
          })}
          <div className="screenshots-operations-divider" />
          <div className={`screenshots-button canvas-annotation-node-button${composing ? " screenshots-button-disabled" : ""}`} title={t("ui.ImageAnnotationEditor.title.47c2b176")} onClick={() => compose(onCreateNode)}>
            <IconSymbol name="arrow-up" />
          </div>
        </div>
      </div>}
    </ScreenshotsContext.Provider>
  </div>, root);
}

export function ImageAnnotationOverlay({ annotations }: { annotations: ImageAnnotation[] }) { return <>{annotations.length ? null : null}</>; }
