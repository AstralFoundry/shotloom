import { useRef, useState, type PointerEvent } from 'react';
import { DIRECTOR_AGENT_ID } from '../../agent/agents/definitions';
import { HarnessChatPanel } from './HarnessChatPanel';

const WIDTH_KEY = 'shotloom:director-agent-width';
const MIN_WIDTH = 280;
const DEFAULT_WIDTH = 400;
/** Keep the desk usable: the column may never squeeze the stage below this width. */
const STAGE_RESERVE = 480;

/**
 * Assistant column for the director desk.
 *
 * The width is a UI preference and the collapse state is session-local: collapsing is a
 * temporary "let me see the whole stage" action, not a setting worth restoring on reload —
 * a desk that reopens with the assistant hidden reads as broken.
 */
export function DirectorAgentPane({
  className,
  nodeId,
  collapsible = false,
  reopenLabel,
  onCollapsedChange,
}: {
  className: string;
  nodeId?: string;
  /** Only the full-page workspace lets the column collapse; the canvas detail window needs it. */
  collapsible?: boolean;
  reopenLabel?: string;
  onCollapsedChange?: (collapsed: boolean) => void;
}) {
  const [width, setWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(stored) && stored >= MIN_WIDTH ? stored : DEFAULT_WIDTH;
  });
  const [collapsed, setCollapsed] = useState(false);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const asideRef = useRef<HTMLElement>(null);

  const setCollapsedState = (next: boolean) => {
    setCollapsed(next);
    onCollapsedChange?.(next);
  };

  /**
   * Clamp a requested width to what the layout can actually give.
   *
   * The available space has to be measured on the *panel's* parent, not on the divider's:
   * the divider sits inside the panel, so `parentElement` from there resolves to the panel
   * itself and the budget collapses to `width - STAGE_RESERVE` — always negative, which
   * pinned every drag to the minimum and made the divider feel dead.
   */
  const resize = (next: number) => {
    const host = asideRef.current?.parentElement;
    const available = (host?.clientWidth || window.innerWidth) - STAGE_RESERVE;
    const value = Math.min(Math.max(MIN_WIDTH, available), Math.max(MIN_WIDTH, Math.round(next)));
    setWidth(value);
    window.localStorage.setItem(WIDTH_KEY, String(value));
  };

  if (collapsed) {
    return (
      <button
        type="button"
        className="director-agent-reopen"
        aria-label={reopenLabel ?? '打开助手'}
        onClick={() => setCollapsedState(false)}
      >
        {reopenLabel ?? '助手'}
      </button>
    );
  }

  return (
    <aside ref={asideRef} className={className} style={{ width, flex: 'none' }}>
      <div
        className="director-agent-resize"
        role="separator"
        aria-label="调整 Agent 对话框宽度"
        aria-orientation="vertical"
        aria-valuemin={MIN_WIDTH}
        tabIndex={0}
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, width };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }}
        onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
          if (drag.current) resize(drag.current.width + drag.current.x - event.clientX);
        }}
        onPointerUp={(event) => {
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onDoubleClick={() => resize(DEFAULT_WIDTH)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            resize(width + (event.key === 'ArrowLeft' ? 24 : -24));
            event.preventDefault();
          } else if (event.key === 'Home') {
            resize(DEFAULT_WIDTH);
            event.preventDefault();
          }
        }}
      />
      <HarnessChatPanel
        agentId={DIRECTOR_AGENT_ID}
        {...(nodeId ? { nodeId } : {})}
        {...(collapsible ? { onClose: () => setCollapsedState(true) } : {})}
      />
    </aside>
  );
}
