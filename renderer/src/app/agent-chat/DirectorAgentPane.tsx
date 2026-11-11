import { useRef, useState, type PointerEvent } from 'react';
import { DIRECTOR_AGENT_ID } from '../../agent/agents/definitions';
import { HarnessChatPanel } from './HarnessChatPanel';

const WIDTH_KEY = 'shotloom:director-agent-width';

export function DirectorAgentPane({ className, nodeId }: { className: string; nodeId?: string }) {
  const [width, setWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(stored) && stored >= 280 ? stored : 400;
  });
  const drag = useRef<{ x: number; width: number } | null>(null);

  const resize = (next: number, container: HTMLElement | null) => {
    const max = Math.max(280, (container?.parentElement?.clientWidth || window.innerWidth) - 480);
    const value = Math.min(max, Math.max(280, Math.round(next)));
    setWidth(value);
    window.localStorage.setItem(WIDTH_KEY, String(value));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) resize(drag.current.width + drag.current.x - event.clientX, event.currentTarget);
  };

  return <aside className={className} style={{ width, flex: 'none' }}>
    <div className="director-agent-resize" role="separator" aria-label="调整 Agent 对话框宽度" aria-orientation="vertical" tabIndex={0}
      onPointerDown={(event) => {
        drag.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { drag.current = null; }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          resize(width + (event.key === 'ArrowLeft' ? 24 : -24), event.currentTarget);
          event.preventDefault();
        }
      }}
    />
    <HarnessChatPanel agentId={DIRECTOR_AGENT_ID} {...(nodeId ? { nodeId } : {})} />
  </aside>;
}
