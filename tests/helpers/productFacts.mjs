/** Minimal product-handler fixtures; no Agent runtime or loop state. */
export function createAgentRunFacts(init = {}) {
  return { hasAppliedActions: false, expectedCanvasFingerprint: '', activeProductionPlanId: '',
    toolReceipts: new Map(), successfulToolCallIds: new Set(), ...init };
}
export function createAgentSessionState() { return {}; }
