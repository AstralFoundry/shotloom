import { TEXT_AGENT_ID } from '../../agent/agents/definitions';
import { HarnessChatPanel } from './HarnessChatPanel';
export function TextAgentPanel({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  return <aside className="text-agent-panel"><HarnessChatPanel agentId={TEXT_AGENT_ID} nodeId={nodeId} onClose={onClose} /></aside>;
}
