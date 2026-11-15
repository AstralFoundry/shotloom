import { desktopApi } from '../../../services/desktopApi';
import type { CompileContext, CompiledProviderRequest, ProviderAdapter, ProviderTask, ProviderTaskState } from '../ProviderAdapter';
import type { ModelRuntimeContract } from '../../catalog/ModelCatalog';
import type { RegisteredProvider } from './ProviderPlugins';

/** Credentials are resolved by the native host, never serialized into plugin requests. */
export class ModuleProviderAdapter implements ProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly iconId: string;
  readonly baseUrl: string;
  readonly baseUrlRequired: boolean;
  constructor(readonly definition: RegisteredProvider) {
    this.id = definition.id; this.name = definition.name; this.description = definition.description || '';
    this.iconId = definition.iconId || 'custom'; this.baseUrl = definition.baseUrl;
    this.baseUrlRequired = definition.baseUrlRequired === true;
  }
  compileRequest(context: CompileContext): CompiledProviderRequest {
    return { providerId: this.id, endpointPath: context.modelContract.endpoint.path,
      endpointScope: context.modelContract.endpoint.scope, endpointMethod: context.modelContract.endpoint.method,
      contract: context.modelContract, signal: context.signal, timeoutMs: context.timeoutMs || 120_000,
      body: { ...context, submissionId: context.submissionId || crypto.randomUUID(), signal: undefined, model: context.modelContract.upstreamModel },
    };
  }
  private async call(method: string, input: unknown, contract?: ModelRuntimeContract, signal?: AbortSignal, timeoutMs?: number): Promise<any> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const requestId = crypto.randomUUID();
    const cancel = () => { void desktopApi.providerPlugins.cancel(requestId); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const result = await desktopApi.providerPlugins.call({ requestId, reference: contract?.pluginRef || this.definition.plugin,
        providerId: this.id, method, input, timeoutMs: timeoutMs || 120_000 });
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return result;
    } finally { signal?.removeEventListener('abort', cancel); }
  }
  async submit(request: CompiledProviderRequest): Promise<ProviderTask> {
    return validatePluginTask(await this.call('submit', request.body, request.contract, request.signal, request.timeoutMs));
  }
  async poll(task: ProviderTask, contract: ModelRuntimeContract, signal?: AbortSignal): Promise<ProviderTaskState> {
    return validatePluginTask(await this.call('poll', { remoteTaskId: task.remoteTaskId, modelContract: contract }, contract, signal), task.remoteTaskId);
  }
  async cancel(task: { remoteTaskId: string; modelContract?: ModelRuntimeContract }): Promise<void> {
    await this.call('cancel', task, task.modelContract);
  }
  async models(): Promise<unknown> { return this.call('models', {}); }
}

export function validatePluginTask(value: any, expectedTaskId?: string): ProviderTask {
  if (!value || typeof value !== 'object' || !['queued','running','completed','failed','timeout','cancelled','error'].includes(value.status)) throw new Error('Plugin returned an invalid task status');
  const remoteTaskId = typeof value.remoteTaskId === 'string' ? value.remoteTaskId : expectedTaskId || '';
  if (expectedTaskId && remoteTaskId !== expectedTaskId) throw new Error('Plugin returned a different task id');
  if (['queued','running'].includes(value.status) && !remoteTaskId) throw new Error('Plugin must return remoteTaskId before polling');
  if (value.status === 'completed' && !value.result) throw new Error('Plugin reported completion without a result');
  return { ...value, remoteTaskId, progress: Number.isFinite(value.progress) ? Math.min(100, Math.max(0, value.progress)) : value.status === 'completed' ? 100 : 0 };
}
