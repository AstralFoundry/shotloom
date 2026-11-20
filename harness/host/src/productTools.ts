import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment';
import type { SessionBinding, ProductRole } from './createHost.js';
import { join } from 'node:path';
import { openDatabase } from './db/connection.js';
import { HostCrud } from './crud/hostCrud.js';
import type { PersistenceBackend } from './persistenceBackend.js';

export interface ProductTool {
  name: string;
  title?: string;
  description: string;
  parameters: ToolDefinition['parameters'];
  roles: readonly ProductRole[];
  effect: 'read' | 'write' | 'generation' | 'delete' | 'overwrite' | 'export';
  /** Set by the product catalog, never by model arguments. */
  approvalRequired?: boolean;
  /** 0 leaves execution unbounded; user cancellation still applies. */
  timeoutMs?: number;
}

export interface ProductBridge {
  url?: string;
  token?: string;
  dispatch?: (request: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
  receipts?: PersistenceBackend['host'];
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
  const target = bridge.url ? new URL(bridge.url) : undefined;
  if (!bridge.dispatch && (!target || target.protocol !== 'http:' || target.hostname !== '127.0.0.1')) {
    throw new Error('Shotloom Tool Bridge must be loopback HTTP');
  }
  if (!bridge.dispatch && !bridge.token) throw new Error('Missing Shotloom Tool Bridge credential');
  async function exchange(request: Record<string, unknown>, signal: AbortSignal, timeoutMs = bridge.timeoutMs ?? 120_000) {
    if (timeoutMs > 0) signal = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    if (bridge.dispatch) return { ok: true, receipt: await bridge.dispatch(request, signal) };
    const response = await fetch(new URL('/tool', target!), {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bridge.token}` },
      body: JSON.stringify({ ...request, token: bridge.token }), signal,
    });
    return { ok: response.ok, receipt: await response.json() as unknown };
  }
  const approval = scope.get('approval');
  if (!approval) throw new Error('Official Harness approval service is required');
  const disposers: Array<() => void> = [];
  const receiptDatabase = !bridge.receipts && bridge.receiptRoot ? openDatabase(join(bridge.receiptRoot, 'agent.sqlite')) : undefined;
  const receiptCrud = bridge.receipts ?? (receiptDatabase && new HostCrud(receiptDatabase));
  if (receiptDatabase) disposers.push(() => receiptDatabase.close());
  for (const tool of catalog.filter(item => item.roles.includes(binding.agentId))) {
    disposers.push(scope.tools.register({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          // The model only needs the tool's own answer. requestId/sessionId/toolName are host
          // bookkeeping that repeated on every call, and the inner `result` envelope made a
          // failed write read as `success: true` one level too deep — flatten both here.
          const envelope = value as Record<string, unknown> & { images?: ImageAttachmentRef[] };
          const images = envelope.images ?? [];
          // HTTP 和 Worker 都在产品回执外包一层传输结果；先拆它，避免聊天 sessionId 冒充场景 sessionId。
          const inner = envelope.result as Record<string, unknown> | undefined;
          const receipt = inner && typeof inner === 'object' && typeof inner.toolName === 'string' ? inner : envelope;
          const { requestId: _requestId, sessionId: _sessionId, toolName: _toolName, references, images: _images, result, ...rest } = receipt;
          const linked = references as { nodeIds?: string[]; taskIds?: string[] } | undefined;
          const payload = {
            ...(typeof envelope.success === 'boolean' ? { success: envelope.success } : {}),
            ...rest,
            ...(result !== undefined && typeof result === 'object' && result !== null && !Array.isArray(result) ? result as Record<string, unknown> : { result }),
            ...(linked?.nodeIds?.length || linked?.taskIds?.length ? { references: linked } : {}),
          };
          return [{ type: 'text', text: JSON.stringify(payload) }, ...images.map(attachment => ({ type: 'image', attachment }))] as ContentBlock[];
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
          const previous = await receiptCrud!.receipt(requestId);
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
            const preflight = await exchange({ op: 'tool', phase: 'authorize',
              requestId: `${delegation?.callerSessionId ?? binding.sessionId}:${exec.callId}:authorize`, binding, toolName: tool.name, input }, exec.signal);
            const body = preflight.receipt as { success?: boolean; result?: { success?: boolean; approvalRequired?: boolean } };
            if (!preflight.ok || body.success === false || body.result?.success !== true) return body;
            requiresApproval = body.result.approvalRequired === true;
          } catch (error) {
            return { success: false, code: 'BRIDGE_UNAVAILABLE', applied: false, error: String(error) };
          }
        }
        let approvedByHarness = false;
        // Full access is an explicit per-Session grant. The official approval
        // service rejects every request under its `never` policy, so no product
        // tool should ask again after the user selected this preset.
        const approvalAgent = delegation ? delegation.approvalAgent() : exec.agent;
        const fullAccessGrant = !!approvalAgent
          && scope.get('permissionPresets')!.current(approvalAgent.session) === 'danger-full-access';
        if (fullAccessGrant) requiresApproval = false;
        if (requiresApproval) {
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
          if (persistReceipt && !await receiptCrud!.claimReceipt(requestId)) return { success: false, code: 'TOOL_OUTCOME_UNKNOWN', requestId };
          const response = await exchange({ op: 'tool', requestId, binding, toolName: tool.name, input, approvedByHarness, authorizedByFullAccess: fullAccessGrant }, exec.signal, tool.timeoutMs);
          const receipt = response.receipt;
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
          if (persistReceipt) await receiptCrud!.settleReceipt(requestId, receipt);
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
  const dispose = () => { for (const dispose of disposers.splice(0).reverse()) dispose(); };
  scope.effect(() => dispose);
  return dispose;
}
