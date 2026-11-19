import { desktopApi } from './desktopApi';
import { validatePluginTask } from '../domain/provider/plugins/ModuleProviderAdapter';
import type { ProcessingContract } from '../domain/provider/plugins/PluginCapabilities';
import { extractGeneratedFiles } from '../utils/generatedOutputParsing';
import type { ProviderTask } from '../domain/provider/ProviderAdapter';

/** Uses the same native module host, credential resolution and submission journal as protocols. */
export async function callPluginAction(method: 'submit' | 'poll' | 'cancel', contract: ProcessingContract,
  input: Record<string, unknown>, signal?: AbortSignal): Promise<ProviderTask> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const requestId = crypto.randomUUID();
  const cancel = () => { void desktopApi.providerPlugins.cancel(requestId); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await desktopApi.providerPlugins.call({ requestId, reference: contract.reference,
      providerId: contract.connectionId, method, input: { ...input, processingContract: contract }, timeoutMs: 120000 });
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const task = validatePluginTask(result, input.remoteTaskId as string | undefined);
    if (method === 'cancel') return task;
    if (task.status === 'completed') {
      const outputs = (task.result as any)?.outputs;
      if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) throw new Error('Capability result requires named outputs');
      const files: any[] = [];
      for (const id of Object.keys(outputs)) if (!contract.capability.outputs.some(slot => slot.id === id)) throw new Error(`Unknown output slot: ${id}`);
      for (const slot of contract.capability.outputs) {
        const values = outputs[slot.id] === undefined ? [] : extractGeneratedFiles(outputs[slot.id]);
        if ((slot.required && !values.length) || (!slot.multiple && values.length > 1)) throw new Error(`Invalid output: ${slot.label}`);
        files.push(...values.map(file => ({ ...file, resourceType: slot.type, metadata: { ...file.metadata, outputSlot: slot.id } })));
      }
      if (!files.length) throw new Error('Capability completed without usable output');
      task.result = { files };
    }
    return task;
  } finally { signal?.removeEventListener('abort', cancel); }
}
