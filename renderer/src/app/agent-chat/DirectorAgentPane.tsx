import type { ReactNode } from 'react';
import { Segmented } from 'antd';
import { t } from '@/i18n';
import { CANVAS_AGENT_ID, DIRECTOR_AGENT_ID } from '../../agent/agents/definitions';
import { HarnessChatPanel } from './HarnessChatPanel';

/** Keep the scene and conversation mounted while switching tabs. */
export function DirectorAgentPane({
  className, children, nodeId, collapsed, onCollapsedChange, entityRequest, onEntityRequestHandled,
}: {
  className: string;
  children: ReactNode;
  nodeId?: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  entityRequest?: { id: string; nonce: number } | undefined;
  onEntityRequestHandled?: (nonce: number) => void;
}) {
  const stageLabel = t('ui.ThreeDDirectorNode.text.a3a5199b');
  const chatLabel = t('director.agent.chatTab');
  return <section className={`${className} director-agent-tabs`}>
    <div className="director-agent-tablist">
      <Segmented aria-label={t('director.agent.label')}
        value={collapsed ? 'stage' : 'agent'}
        onChange={value => onCollapsedChange(value === 'stage')}
        options={[{ label: stageLabel, value: 'stage' }, { label: chatLabel, value: 'agent' }]} />
    </div>
    <div className="director-agent-panels">
      <div className="director-agent-panel" role="region" aria-label={stageLabel} aria-hidden={!collapsed} inert={!collapsed}>
        {children}
      </div>
      <div className="director-agent-panel" role="region" aria-label={chatLabel} aria-hidden={collapsed} inert={collapsed}>
        <HarnessChatPanel agentId={nodeId ? DIRECTOR_AGENT_ID : CANVAS_AGENT_ID} {...(nodeId ? { nodeId } : {})}
          onClose={() => onCollapsedChange(true)}
          directorEntityRequest={entityRequest} onDirectorEntityInserted={onEntityRequestHandled} />
      </div>
    </div>
  </section>;
}
