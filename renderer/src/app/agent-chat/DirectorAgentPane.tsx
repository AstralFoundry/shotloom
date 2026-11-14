import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { t } from '@/i18n';
import { DIRECTOR_AGENT_ID } from '../../agent/agents/definitions';
import { IconSymbol } from '../components/IconSymbol';
import { HarnessChatPanel } from './HarnessChatPanel';
import { listenDirectorDeskAgentAnchor, sendDirectorDeskAgentLayout, type DirectorDeskAgentAnchor } from '../adapters/directorDeskBridge';

/** Floating director conversation. Keep the official client mounted in every state. */
export function DirectorAgentPane({
  className, nodeId, collapsed, onCollapsedChange, entityRequest, onEntityRequestHandled,
}: {
  className: string;
  nodeId?: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  entityRequest?: { id: string; nonce: number } | undefined;
  onEntityRequestHandled?: (nonce: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const expand = useCallback(() => {
    onCollapsedChange(false);
    setExpanded(true);
  }, [onCollapsedChange]);
  const onStatusChange = useCallback((status: 'loading' | 'ready' | 'error') => {
    if (status === 'error') expand();
  }, [expand]);
  const mode = collapsed ? 'compact' : expanded ? 'expanded' : 'input';
  const dock = useRef<HTMLElement>(null);
  const motion = useRef<{ mode: string; boxes: Map<Element, DOMRect> } | undefined>(undefined);
  const animations = useRef<Animation[]>([]);
  useEffect(() => () => { for (const animation of animations.current) animation.cancel(); }, []);
  useEffect(() => {
    const element = dock.current;
    const parent = element?.parentElement;
    const frame = parent?.querySelector('iframe');
    if (!element || !parent || !frame) return;
    let lastLayout = '';
    let anchor: DirectorDeskAgentAnchor | undefined;
    const layout = () => {
      if (!anchor) return;
      const composer = element.querySelector('.harness-chat-frame')?.shadowRoot;
      const targets = [element.querySelector('.director-agent-card'), element.querySelector('.director-agent-history'),
        element.querySelector('.director-agent-back'), composer?.querySelector('[data-composer-card]'),
        composer?.querySelector('[data-input-scroll]'),
        composer?.querySelector('[data-composer-card] > div > div:has(> [data-slot="conversation.input.left"])'),
        composer?.querySelector('[data-composer-card] > div > div:has([data-slot="conversation.input.model"])')]
        .filter((target): target is HTMLElement => target instanceof HTMLElement);
      const previous = motion.current;
      const bounds = parent.getBoundingClientRect();
      const frameBounds = frame.getBoundingClientRect();
      const stacked = anchor.width < anchor.toolbarWidth + 320;
      const width = collapsed ? Math.min(360, Math.max(220, anchor.width - (stacked ? 40 : anchor.toolbarWidth + 36))) : Math.min(640, Math.max(220, anchor.width - 100));
      element.style.width = `${width}px`;
      element.style.setProperty('--director-composer-height', `${anchor.toolbarHeight}px`);
      element.style.left = `${frameBounds.left - bounds.left + anchor.x + anchor.width / 2 + (collapsed && !stacked ? anchor.toolbarWidth / 2 + 6 : 0)}px`;
      element.style.bottom = `${bounds.bottom - frameBounds.top - anchor.y - anchor.height + (collapsed && stacked ? 22 + anchor.toolbarHeight + 12 : 22)}px`;
      element.style.maxHeight = `${Math.max(120, anchor.height - 52)}px`;
      const boxes = new Map(targets.map(target => [target, target.getBoundingClientRect()]));
      if (previous && previous.mode !== mode) {
        for (const animation of animations.current) animation.cancel();
        animations.current = [];
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          for (const target of targets) {
            const from = previous.boxes.get(target), to = boxes.get(target);
            if (!from || !to || !from.width || !to.width || !from.height || !to.height) continue;
            const surface = target.matches('.director-agent-card, [data-composer-card]');
            const dx = from.left - to.left, dy = from.top - to.top;
            // Only the surface scales. Editor, icons and buttons move at their
            // actual size, preserving readable text throughout the transition.
            const transform = `translate(${dx}px, ${dy}px)${surface ? ` scale(${from.width / to.width}, ${from.height / to.height})` : ''}`;
            animations.current.push(target.animate([{ transform }, { transform: 'none' }], {
              duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)',
              ...(surface ? { pseudoElement: '::before' } : {}),
            }));
          }
        }
      }
      motion.current = { mode, boxes };
      const next = JSON.stringify({ mode, width, stacked });
      if (lastLayout !== next) {
        lastLayout = next;
        sendDirectorDeskAgentLayout(frame, { mode, width, stacked });
      }
    };
    const stopListening = listenDirectorDeskAgentAnchor(frame, value => {
      anchor = value;
      layout();
    });
    const request = () => {
      lastLayout = '';
      sendDirectorDeskAgentLayout(frame, { mode, width: element.offsetWidth, stacked: false });
    };
    const observer = new ResizeObserver(layout);
    observer.observe(parent);
    frame.addEventListener('load', request);
    request();
    return () => { observer.disconnect(); stopListening(); frame.removeEventListener('load', request); };
  }, [mode, collapsed]);
  return (
    <aside ref={dock} className={`${className} director-agent-dock`} data-director-mode={mode} aria-label={t('director.agent.label')}
      style={{ '--shotloom-director-placeholder': JSON.stringify(t('director.agent.placeholder')) } as CSSProperties}
      onDoubleClickCapture={event => {
        if (collapsed && event.nativeEvent.composedPath().some(target => target instanceof HTMLElement && target.matches('[data-input-scroll], [data-composer-input], [data-composer-placeholder]'))) {
          event.preventDefault();
          onCollapsedChange(false);
        }
      }}>
      <button type="button" className="director-agent-back" tabIndex={collapsed ? -1 : 0} aria-hidden={collapsed} aria-label={t('director.agent.minimize')}
        title={t('director.agent.minimize')} onClick={() => onCollapsedChange(true)}><IconSymbol name="chevron-left" /></button>
      <div className="director-agent-card">
        <button type="button" className="director-agent-history" tabIndex={collapsed ? -1 : 0} aria-hidden={collapsed} aria-expanded={expanded}
          onClick={() => setExpanded(value => !value)}>
          <span>{t('director.agent.history')}</span><IconSymbol name={expanded ? 'chevron-down' : 'chevron-right'} />
        </button>
        <HarnessChatPanel
          agentId={DIRECTOR_AGENT_ID}
          {...(nodeId ? { nodeId } : {})}
          directorMode={mode}
          onTurnStart={expand}
          onStatusChange={onStatusChange}
          onClose={() => setExpanded(false)}
          directorEntityRequest={entityRequest}
          onDirectorEntityInserted={onEntityRequestHandled}
        />
      </div>
    </aside>
  );
}
