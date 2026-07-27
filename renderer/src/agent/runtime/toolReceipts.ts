import type { AgentToolEffect, AgentToolReceipt, JsonObject } from '../core/types';

const persistentEffects = new Set<AgentToolEffect>(['project_write', 'canvas_write', 'media_generation']);

function stringIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).filter(Boolean))];
}

export function buildToolReceipt(
  callId: string,
  toolName: string,
  effect: AgentToolEffect,
  result: unknown,
): AgentToolReceipt {
  const value = result && typeof result === 'object' ? result as JsonObject : {};
  const skippedCount = Number(value.skippedCount || 0);
  const appliedCount = Number(value.appliedCount || 0);
  const success = value.success !== false;
  const nodeIds = stringIds([
    ...stringIds(value.createdNodeIds),
    ...stringIds(value.changedNodeIds),
    ...stringIds(value.nodeIds),
  ]);
  const taskIds = stringIds([
    ...stringIds(value.startedTaskIds),
    ...stringIds(value.taskIds),
  ]);
  let applied = appliedCount > 0 || value.applied === true || nodeIds.length > 0 || taskIds.length > 0;
  if (effect === 'project_write' && success) applied = true;
  const partial = value.partial === true || skippedCount > 0 || (applied && value.complete === false);
  return {
    callId,
    toolName,
    effect,
    success,
    applied,
    partial,
    skippedCount,
    nodeIds,
    taskIds,
    error: success ? '' : String(value.error || '工具执行失败'),
  };
}

export function receiptChangesProject(receipt: AgentToolReceipt): boolean {
  return persistentEffects.has(receipt.effect) && receipt.applied;
}

export function receiptProvesCompletion(receipt: AgentToolReceipt): boolean {
  return receiptChangesProject(receipt) && receipt.success && !receipt.partial;
}
