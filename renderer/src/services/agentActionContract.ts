import contract from '../config/agent-action-contract.json';
import type { AgentAction, JsonObject } from './agentTypes';

export interface AgentActionSpec extends JsonObject {
  category?: string;
  modelVisible?: boolean;
  description?: string;
  fields?: string[];
  required?: string[];
  anyOfRequired?: string[][];
}

export interface AgentActionContractValidation {
  valid: boolean;
  error?: string;
  spec?: AgentActionSpec;
}

export const agentActionContract = Object.freeze(contract);
export const agentActionSpecs = Object.freeze(contract.actions || {}) as Record<string, AgentActionSpec>;
export const supportedAgentActionTypes = new Set(Object.keys(agentActionSpecs));

export function agentActionSpec(type: string): AgentActionSpec | null {
  return agentActionSpecs[type] || null;
}

export function modelVisibleAgentActionTypes(): string[] {
  return Object.entries(agentActionSpecs)
    .filter(([, spec]) => spec.modelVisible !== false)
    .map(([type]) => type);
}

export function validateAgentActionContract(action: Partial<AgentAction> | null | undefined): AgentActionContractValidation {
  const actionType = typeof action?.type === 'string' ? action.type : '';
  const spec = agentActionSpec(actionType);
  if (!spec) return { valid: false, error: `unknown action type: ${action?.type || ''}` };

  // Required business fields are deliberately not enforced by the shared
  // contract. The executor validates each normalized action independently.
  return { valid: true, spec };
}
