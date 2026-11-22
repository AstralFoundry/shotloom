import type { AgentPetState } from '../../../services/agentPetArchive';
import { t } from '@/i18n';
import { EDITOR_AGENT_ID } from '../../../agent/agents/definitions';
import { HarnessChatPanel } from '../../agent-chat/HarnessChatPanel';
export function OpenReelAgentPanel({ nodeId, width, onClose, hidden, onActivityChange }: {
  nodeId: string; width: number; onClose: () => void; hidden: boolean; onActivityChange: (phase: AgentPetState) => void;
}) {
  return <aside className="ov-openreel-agent" aria-label={t("ui.VideoEditorWorkspace.text.61b7624d")} style={{ width }} hidden={hidden}>
    <HarnessChatPanel agentId={EDITOR_AGENT_ID} nodeId={nodeId} onClose={onClose} onActivityChange={onActivityChange} />
  </aside>;
}
