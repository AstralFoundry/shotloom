import { t } from '@/i18n';
import type { CSSProperties } from 'react';
import { EDITOR_AGENT_ID } from '../../../agent/agents/definitions';
import { HarnessChatPanel } from '../../agent-chat/HarnessChatPanel';
export function OpenReelAgentPanel({ nodeId, width, onClose }: {
  nodeId: string; width: number; onClose: () => void;
}) {
  return <aside className="ov-openreel-agent" aria-label={t("ui.VideoEditorWorkspace.text.61b7624d")} style={{ '--editor-agent-width': `${width}px` } as CSSProperties}>
    <HarnessChatPanel agentId={EDITOR_AGENT_ID} nodeId={nodeId} onClose={onClose} />
  </aside>;
}
