import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment';
import type { SessionBinding, ProductRole } from './createHost.js';
import { join } from 'node:path';
import { openDatabase } from './db/connection.js';
import { HostCrud } from './crud/hostCrud.js';

export interface ProductTool {
  name: string;
  title?: string;
  description: string;
  parameters: ToolDefinition['parameters'];
  roles: readonly ProductRole[];
  effect: 'read' | 'write' | 'generation' | 'delete' | 'overwrite' | 'export';
  /** Set by the product catalog, never by model arguments. */
  approvalRequired?: boolean;
}

export interface ProductBridge {
  url: string;
  token: string;
  timeoutMs?: number;
  authorize?: boolean;
  /** Durable product-operation receipts; official persistence owns Session events. */
  receiptRoot?: string;
}

/** Registers named product tools, with no general tool-name forwarding escape. */
export function registerProductTools(
  scope: Context,
  binding: Readonly<SessionBinding>,
  catalog: readonly ProductTool[],
  bridge: ProductBridge,
  delegation?: { callerSessionId: string; approvalAgent: () => Agent | undefined },
) {
  const target = new URL(bridge.url);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1') {
    throw new Error('Shotloom Tool Bridge must be loopback HTTP');
  }
  if (!bridge.token) throw new Error('Missing Shotloom Tool Bridge credential');
  const approval = scope.get('approval');
  if (!approval) throw new Error('Official Harness approval service is required');
  const disposers: Array<() => void> = [];
  const receiptDatabase = bridge.receiptRoot ? openDatabase(join(bridge.receiptRoot, 'agent.sqlite')) : undefined;
  const receiptCrud = receiptDatabase && new HostCrud(receiptDatabase);
  if (receiptDatabase) disposers.push(() => receiptDatabase.close());
  for (const tool of catalog.filter(item => item.roles.includes(binding.agentId))) {
    disposers.push(scope.tools.register({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          const images = (value as { images?: ImageAttachmentRef[] }).images ?? [];
          return [{ type: 'text', text: JSON.stringify(value) }, ...images.map(attachment => ({ type: 'image', attachment }))] as ContentBlock[];
        },
      },
      isConcurrencySafe: () => tool.effect === 'read',
      async execute(input, exec) {
        if (!exec.agent || String(exec.agent.session.id) !== (delegation?.callerSessionId ?? binding.sessionId)) {
          return { success: false, code: 'SCOPE_MISMATCH', error: 'Tool caller does not own this Shotloom session' };
        }
        exec.signal.throwIfAborted();
        const requestId = `${delegation?.callerSessionId ?? binding.sessionId}:${exec.callId}`;
        const persistReceipt = tool.effect !== 'read' && !!receiptCrud;
        if (persistReceipt) {
          const previous = receiptCrud!.receipt(requestId);
          if (previous) {
            return previous.status === 'settled' ? previous.payload : {
              success: false, code: 'TOOL_OUTCOME_UNKNOWN', requestId,
              recovery: 'A prior dispatch has no durable receipt. Inspect real project/task state before retrying as a new call.',
            };
          }
        }
        let requiresApproval = tool.approvalRequired === true;
        if (bridge.authorize) {
          try {
            const preflight = await fetch(new URL('/tool', target), {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ op: 'tool', phase: 'authorize', token: bridge.token,
                requestId: `${delegation?.callerSessionId ?? binding.sessionId}:${exec.callId}:authorize`, binding, toolName: tool.name, input }),
              signal: AbortSignal.any([exec.signal, AbortSignal.timeout(bridge.timeoutMs ?? 120_000)]),
            });
            const body = await preflight.json() as { success?: boolean; result?: { success?: boolean; approvalRequired?: boolean } };
            if (!preflight.ok || body.success === false || body.result?.success !== true) return body;
            requiresApproval = body.result.approvalRequired === true;
          } catch (error) {
            return { success: false, code: 'BRIDGE_UNAVAILABLE', applied: false, error: String(error) };
          }
        }
        let approvedByHarness = false;
        if (requiresApproval) {
          const approvalAgent = delegation ? delegation.approvalAgent() : exec.agent;
          if (!approvalAgent) return { success: false, code: 'PARENT_SESSION_UNAVAILABLE', applied: false };
          if (delegation) {
            const lastBoundary = approvalAgent.session.snapshotEvents().findLast(event => event.type === 'turn/start' || event.type === 'turn/end');
            if (lastBoundary?.type !== 'turn/start') return { success: false, code: 'PARENT_APPROVAL_REQUIRED', applied: false,
              error: 'The canvas parent must delegate this edit again so its active turn can own the approval. No edit was applied.' };
          }
          const outcome = await approval.request({
            agent: approvalAgent, callId: exec.callId, toolName: tool.name,
            reason: tool.description, signal: exec.signal,
          });
          if (outcome !== 'allowed-once') {
            return { success: false, code: 'APPROVAL_REQUIRED', outcome, applied: false };
          }
          approvedByHarness = true;
        }
        // Binding and credential originate in trusted composition, not input.
        // The desktop revalidates project/node existence and current settings.
        try {
          if (persistReceipt && !receiptCrud!.claimReceipt(requestId)) return { success: false, code: 'TOOL_OUTCOME_UNKNOWN', requestId };
          const response = await fetch(new URL('/tool', target), {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${bridge.token}` },
            body: JSON.stringify({ op: 'tool', token: bridge.token, requestId, binding, toolName: tool.name, input, approvedByHarness }),
            signal: AbortSignal.any([exec.signal, AbortSignal.timeout(bridge.timeoutMs ?? 120_000)]),
          });
          const receipt: unknown = await response.json();
          if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
            throw new Error('Bridge did not return a structured receipt');
          }
          const record = receipt as { result?: { result?: { __toolAttachments?: Array<{ mime: ImageMediaType; filename?: string; url: string }> } }; images?: ImageAttachmentRef[] };
          const payload = record.result?.result;
          if (payload?.__toolAttachments?.length) {
            const images = await scope.get('attachments')!.saveImages(payload.__toolAttachments.map(item => {
              const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(item.url);
              if (!match || match[1] !== item.mime) throw new Error('Product image receipt must contain verified encoded image bytes');
              return { data: Buffer.from(match[2]!, 'base64'), mediaType: item.mime, ...(item.filename ? { name: item.filename } : {}) };
            }));
            record.images = [...images];
            delete payload.__toolAttachments;
          }
          if (persistReceipt) receiptCrud!.settleReceipt(requestId, receipt);
          if (!response.ok) return { success: false, code: 'BRIDGE_REJECTED', requestId, receipt };
          return receipt;
        } catch (error) {
          // An uncertain mutation must be reconciled, never automatically retried.
          return {
            success: false, code: tool.effect === 'read' ? 'BRIDGE_UNAVAILABLE' : 'TOOL_OUTCOME_UNKNOWN',
            requestId, error: error instanceof Error ? error.message : String(error),
            recovery: 'Read the real project/task state before deciding whether to retry.',
          };
        }
      },
    }));
  }
  return () => { for (const dispose of disposers.splice(0).reverse()) dispose(); };
}
