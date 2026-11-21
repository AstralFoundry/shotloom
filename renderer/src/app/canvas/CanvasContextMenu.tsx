import { useEffect, useRef } from 'react';
import { t } from '@/i18n';
import { IconSymbol } from "../components/IconSymbol";
import { nodeTypes } from "../constants/navigation";

export function CanvasContextMenu(
  { x, y, port, onCreate, onClose, onOpenPoseLibrary }: {
    x: number;
    y: number;
    port?: { side: 'left' | 'right'; allowedTypes: readonly string[] };
    onClose?: () => void;
    onCreate: (type: string) => void | Promise<void>;
    onOpenPoseLibrary?: (() => void) | undefined;
  },
) {
  const menuRef = useRef<HTMLDivElement>(null);
  const title = port
    ? t(port.side === 'left' ? 'canvas.port.createUpstream' : 'canvas.port.createDownstream')
    : t("ui.CanvasContextMenu.text.7976e0d9");
  const options = port ? nodeTypes.filter(item => port.allowedTypes.includes(item.id)) : nodeTypes;
  useEffect(() => {
    if (port) menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [port]);
  return (
    <div
      ref={menuRef}
      className="canvas-context-menu"
      role="menu"
      aria-label={port ? title : t("ui.CanvasContextMenu.arialabel.a88f7dd2")}
      onKeyDown={event => {
        if (!port) return;
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose?.();
          return;
        }
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
        if (!buttons.length) return;
        event.preventDefault();
        event.stopPropagation();
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      {!port && <>
        <div className="canvas-context-menu-section" role="group" aria-labelledby="canvas-menu-assets">
          <span id="canvas-menu-assets" className="canvas-context-menu-label">{t("ui.CanvasContextMenu.text.06614c23")}</span>
          <button type="button" role="menuitem" onClick={() => void onCreate("__upload__")}>
            <i><IconSymbol name="upload" /></i>
            <span>{t("ui.CanvasContextMenu.text.a977650d")}</span>
          </button>
        </div>
        <div className="canvas-context-menu-section" role="group" aria-label={t('canvas.section.create')}>
          <button type="button" role="menuitem" onClick={() => void onCreate('canvasSection')}>
            <i><IconSymbol name="layers" /></i><span>{t('canvas.section.create')}</span>
          </button>
          {onOpenPoseLibrary ? (
            <button type="button" role="menuitem" onClick={() => { onOpenPoseLibrary(); }}>
              <i><IconSymbol name="user" /></i><span>{t('canvas.pose.title')}</span>
            </button>
          ) : null}
        </div>
      </>}
      <div className="canvas-context-menu-section" role="group" aria-labelledby="canvas-menu-nodes">
        <span id="canvas-menu-nodes" className="canvas-context-menu-label">{title}</span>
        {options.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            onClick={() => void onCreate(item.id)}
          >
            <i><IconSymbol name={item.icon} /></i>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
