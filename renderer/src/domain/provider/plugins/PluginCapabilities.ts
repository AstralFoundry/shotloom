import { allProviderPlugins, pluginManifestAt, providerConnections, type PluginReference } from './ProviderPlugins';
import { capabilityParameterErrors, type PluginCapability } from '../../../../../shared/pluginCapabilities';
import { selectedNodeMedia } from '../../../utils/nodeMedia';
export type { PluginCapability, CapabilityParameter, CapabilityMediaType } from '../../../../../shared/pluginCapabilities';

export interface RegisteredCapability {
  key: string;
  pluginName: string;
  reference: PluginReference;
  digest: string;
  capability: PluginCapability;
}
export interface CapabilityInput {
  nodeId: string;
  mediaId: string;
  type: string;
  filePath: string;
  url: string;
}
export interface ProcessingContract extends RegisteredCapability {
  contractVersion: 1;
  connectionId: string;
  operation: unknown;
  inputs: Record<string, CapabilityInput[]>;
  parameters: Record<string, unknown>;
}

export function registeredCapabilities(): RegisteredCapability[] {
  return allProviderPlugins().filter(p => p.enabled && !p.removed && !p.retired).flatMap(p => (p.manifest.capabilities || []).map(capability => ({
    key: `plugin:${p.manifest.id}:${capability.id}`, pluginName: p.manifest.name,
    reference: { id: p.manifest.id, version: p.manifest.version, providerId: p.manifest.kind === 'vendor' ? 'tools' : 'protocol' }, digest: p.digest, capability,
  })));
}

export function capabilityConnections(pluginId: string) {
  return providerConnections().filter(c => c.enabled !== false && c.pluginId === pluginId && ['protocol', 'vendor'].includes(c.presetId));
}

export function nodeCapabilityMedia(node: Record<string, any>, project?: any): CapabilityInput | null {
  const media = selectedNodeMedia(node, project);
  const type = ({ imageGeneration: 'image', videoGeneration: 'video', audioGeneration: 'audio' } as Record<string, string>)[node.type]
    || media?.resourceType;
  if (!['image', 'video', 'audio'].includes(type) || !media) return null;
  const filePath = String(media.filePath || media.path || '');
  const url = String(media.url || media.remoteUrl || media.previewUrl || '');
  if (!filePath && !url) return null;
  return { nodeId: node.id, mediaId: String(media.materialId || media.id || filePath || url), type, filePath, url };
}

export function capabilitiesForNode(node: Record<string, any>, project?: any, surface: 'toolbar' | 'contextMenu' = 'toolbar') {
  const media = nodeCapabilityMedia(node, project);
  return media ? registeredCapabilities().filter(c => c.capability.surfaces.includes(surface) && c.capability.inputs.some(slot => slot.type === media.type)) : [];
}

/** Preparation reports correctable facts; it never submits or creates canvas data. */
export function preparePluginAction({ key, connectionId, inputs, parameters = {} }: {
  key: string; connectionId: string; inputs: Record<string, string[]>; parameters?: Record<string, unknown>;
}, project: any): { ready: boolean; errors: string[]; contract?: ProcessingContract } {
  const registered = registeredCapabilities().find(c => c.key === key);
  if (!registered) return { ready: false, errors: ['Plugin capability is not installed or enabled'] };
  const { capability, reference } = registered;
  const connection = capabilityConnections(reference.id).find(c => c.id === connectionId);
  const errors: string[] = connection ? [] : ['Select an enabled connection for this plugin'];
  const values: Record<string, unknown> = Object.fromEntries(capability.parameters.filter(p => p.default !== undefined).map(p => [p.id, p.default]));
  Object.assign(values, parameters);
  errors.push(...capabilityParameterErrors(capability.parameters, values));
  const bound: Record<string, CapabilityInput[]> = {};
  for (const key of Object.keys(inputs)) if (!capability.inputs.some(slot => slot.id === key)) errors.push(`Unknown input slot: ${key}`);
  for (const slot of capability.inputs) {
    const ids = inputs[slot.id] || [];
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) { errors.push(`Invalid input: ${slot.label}`); continue; }
    if (slot.required && !ids.length) errors.push(`Required input: ${slot.label}`);
    if (!slot.multiple && ids.length > 1) errors.push(`Input accepts one item: ${slot.label}`);
    bound[slot.id] = [];
    for (const id of ids) {
      const node = project.nodes.find((n: any) => n.id === id);
      const media = node && nodeCapabilityMedia(node, project);
      if (!media || media.type !== slot.type) errors.push(`Unavailable ${slot.type} input: ${slot.label} (${id})`);
      else bound[slot.id]!.push(media);
    }
  }
  // Freeze the installed package's original data, not translated display metadata.
  // The native host verifies these objects against the pinned package verbatim.
  const manifest = pluginManifestAt(reference);
  const originalCapability = manifest?.capabilities?.find(item => item.id === capability.id);
  const operation = manifest?.protocols.find(item => item.id === originalCapability?.operation);
  if (!originalCapability || !operation) return { ready: false, errors: [...errors, 'Pinned plugin capability or operation is unavailable'] };
  const contract: ProcessingContract = { ...registered, capability: originalCapability, contractVersion: 1, connectionId, operation, inputs: bound, parameters: values };
  return { ready: !errors.length, errors, contract: JSON.parse(JSON.stringify(contract)) };
}
