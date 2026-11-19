import { preparePluginAction, type ProcessingContract } from '../domain/provider/plugins/PluginCapabilities';
import { store } from './projectStore';
import { settingsStore } from './settingsStore';
import { startPluginProcessingTask } from './taskStore';
import { submissionFingerprint } from '../domain/tasks/Submission';
import { allProviderPlugins, providerConnections } from '../domain/provider/plugins/ProviderPlugins';
import { projectOperationBlockReason } from '../services/projectOperationGuards';
import { desktopApi } from '../services/desktopApi';

export type PluginActionRequest = Parameters<typeof preparePluginAction>[0];

export function prepareCanvasPluginAction(request: PluginActionRequest) {
  const prepared = preparePluginAction(request, store.project);
  const errors = [...prepared.errors];
  if (desktopApi.platform === 'browser') errors.push('Plugin actions require the desktop app');
  if (!store.projectDir) errors.push('Save the project before running this action');
  const busy = projectOperationBlockReason(store.project);
  if (busy) errors.push(busy);
  if (prepared.contract) {
    const plugin = allProviderPlugins().find(p => p.manifest.id === prepared.contract!.reference.id);
    if (!plugin?.trustedCode) errors.push('Trust this code plugin before running its actions');
    const connection = providerConnections().find(c => c.id === request.connectionId);
    const config = settingsStore.providerConfigs[request.connectionId];
    if (!(config?.baseUrl || connection?.baseUrl)) errors.push('Configure a service address for this connection');
    if (connection?.authRequired !== false && !config?.apiKey) errors.push('Configure an API key for this connection');
  }
  return { ...prepared, ready: !errors.length, errors };
}

/** All user and Agent entry points converge here; no vendor-specific canvas branch. */
export async function runCanvasPluginAction(request: PluginActionRequest, submissionId: string) {
  const prepared = prepareCanvasPluginAction(request);
  if (!prepared.ready || !prepared.contract) throw new Error(prepared.errors.join('\n'));
  const contract: ProcessingContract = prepared.contract;
  const fingerprint = submissionFingerprint({ processingContract: contract });
  const existing = (store.project.tasks as any[]).find(task => task.submissionId === submissionId);
  if (existing) {
    if (existing.requestFingerprint !== fingerprint) throw new Error('Submission ID belongs to different inputs');
    return { taskId: existing.id, sourceNodeIds: existing.sourceNodeIds, status: existing.status };
  }
  const sourceIds = [...new Set(Object.values(contract.inputs).flat().map(input => input.nodeId))];
  const source = store.project.nodes.find((n: any) => n.id === sourceIds[0]);
  const id = crypto.randomUUID();
  const node = { id, type: 'pluginProcessing', title: contract.capability.name,
    x: Number(source?.x || 0), y: Number(source?.y || 0), canvasWidth: 350, canvasHeight: 220,
    status: 'idle', progress: 0, processingContract: contract, createdAt: new Date().toISOString() };
  const task = await startPluginProcessingTask(node, contract, submissionId);
  return { taskId: task.id, sourceNodeIds: sourceIds, status: task.status };
}
