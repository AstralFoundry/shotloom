import type { AgentPetState } from '../../services/agentPetArchive';
import { TEXT_AGENT_ID } from '../../agent/agents/definitions';
import { HarnessChatPanel } from './HarnessChatPanel';
export function TextAgentPanel({ nodeId, onClose, hidden, onActivityChange }: { nodeId: string; onClose: () => void; hidden: boolean; onActivityChange: (phase: AgentPetState) => void }) {
  return <aside className="text-agent-panel" hidden={hidden}><HarnessChatPanel agentId={TEXT_AGENT_ID} nodeId={nodeId} onClose={onClose} onActivityChange={onActivityChange} /></aside>;
}
