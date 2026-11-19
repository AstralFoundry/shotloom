/** Versioned, data-only contract shared by package validation and canvas execution. */
export type CapabilityMediaType = 'image' | 'video' | 'audio';
export interface CapabilitySlot {
  id: string;
  label: string;
  type: CapabilityMediaType;
  required?: boolean;
  multiple?: boolean;
}
export interface CapabilityParameter {
  id: string;
  label: string;
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  default?: string | number | boolean;
  enum?: Array<string | number | boolean>;
  minimum?: number;
  maximum?: number;
  visibleWhen?: { parameter: string; equals: string | number | boolean };
}
export interface PluginCapability {
  id: string;
  name: string;
  description: string;
  operation: string;
  inputs: CapabilitySlot[];
  outputs: CapabilitySlot[];
  parameters: CapabilityParameter[];
  surfaces: Array<'toolbar' | 'contextMenu'>;
  supportsCancel?: boolean;
}
export const capabilityIdValid = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,95}$/.test(value);
const object = (v: unknown): v is Record<string, any> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
const mediaTypes = ['image', 'video', 'audio'];
const primitive = (v: unknown) => ['string', 'number', 'boolean'].includes(typeof v) && (typeof v !== 'number' || Number.isFinite(v));

export function capabilityParameterErrors(parameters: CapabilityParameter[], values: Record<string, unknown>, requireValues = true): string[] {
  const errors: string[] = [];
  for (const key of Object.keys(values)) if (!parameters.some(p => p.id === key)) errors.push(`Unknown parameter: ${key}`);
  for (const p of parameters) {
    const value = values[p.id];
    const visible = !p.visibleWhen || values[p.visibleWhen.parameter] === p.visibleWhen.equals;
    if (value === undefined || value === '') {
      if (requireValues && visible && p.required) errors.push(`Required parameter: ${p.label}`);
      continue;
    }
    if (typeof value !== p.type || !primitive(value)) errors.push(`Invalid parameter type: ${p.label}`);
    else if (p.enum && !p.enum.includes(value as string | number | boolean)) errors.push(`Unsupported parameter value: ${p.label}`);
    else if (typeof value === 'number' && ((p.minimum !== undefined && value < p.minimum) || (p.maximum !== undefined && value > p.maximum))) errors.push(`Parameter out of range: ${p.label}`);
  }
  return errors;
}

export function pluginCapabilityErrors(manifest: unknown): string[] {
  if (!object(manifest)) return ['Invalid capability manifest'];
  if (manifest.apiVersion === 1) return manifest.capabilities !== undefined ? ['Capabilities require apiVersion 2'] : [];
  if (manifest.apiVersion !== 2) return ['Unsupported plugin apiVersion'];
  const errors: string[] = [];
  if (manifest.kind === 'vendor' && manifest.capabilities === undefined) return errors;
  if (manifest.kind === 'vendor' ? !manifest.runtime : manifest.kind !== 'protocol' || manifest.engine !== 'module') errors.push('Capability packages require a plugin runtime');
  if (!Array.isArray(manifest.capabilities) || !manifest.capabilities.length) return [...errors, 'apiVersion 2 requires capabilities'];
  const ids = new Set<string>();
  for (const c of manifest.capabilities) {
    if (!object(c)) { errors.push('Invalid capability'); continue; }
    if (!capabilityIdValid(c.id) || ids.has(c.id)) errors.push('Invalid or duplicate capability id');
    ids.add(c.id);
    if (typeof c.name !== 'string' || !c.name.trim() || typeof c.description !== 'string' || !c.description.trim()) errors.push('Capability needs name and description');
    if (!manifest.protocols?.some((p: any) => p.id === c.operation)) errors.push(`Unknown capability operation: ${c.operation}`);
    if (c.supportsCancel !== undefined && typeof c.supportsCancel !== 'boolean') errors.push('Invalid cancellation support');
    if (!Array.isArray(c.surfaces) || c.surfaces.some((s: unknown) => !['toolbar', 'contextMenu'].includes(String(s)))) errors.push('Invalid capability surfaces');
    for (const key of ['inputs', 'outputs']) {
      if (!Array.isArray(c[key]) || !c[key].length) { errors.push(`Capability needs ${key}`); continue; }
      const slots = new Set<string>();
      for (const slot of c[key]) {
        if (!object(slot) || !capabilityIdValid(slot.id) || slots.has(slot.id) || typeof slot.label !== 'string' || !slot.label.trim() || !mediaTypes.includes(slot.type)
          || (slot.required !== undefined && typeof slot.required !== 'boolean') || (slot.multiple !== undefined && typeof slot.multiple !== 'boolean')) errors.push(`Invalid ${key} slot`);
        if (object(slot)) slots.add(slot.id);
      }
    }
    if (!Array.isArray(c.parameters)) { errors.push('Capability parameters must be an array'); continue; }
    const params = new Set<string>();
    for (const p of c.parameters) {
      if (!object(p) || !capabilityIdValid(p.id) || params.has(p.id) || typeof p.label !== 'string' || !p.label.trim() || !['string', 'number', 'boolean'].includes(p.type)) { errors.push('Invalid capability parameter'); continue; }
      params.add(p.id);
      if (p.required !== undefined && typeof p.required !== 'boolean') errors.push(`Invalid required flag: ${p.id}`);
      if (p.enum !== undefined && (!Array.isArray(p.enum) || !p.enum.length || p.enum.some((v: unknown) => typeof v !== p.type || !primitive(v)))) errors.push(`Invalid parameter choices: ${p.id}`);
      for (const key of ['minimum', 'maximum']) if (p[key] !== undefined && (p.type !== 'number' || !Number.isFinite(p[key]))) errors.push(`Invalid parameter bound: ${p.id}`);
      if (p.minimum !== undefined && p.maximum !== undefined && p.minimum > p.maximum) errors.push(`Invalid parameter range: ${p.id}`);
      if (p.default !== undefined) errors.push(...capabilityParameterErrors([p as unknown as CapabilityParameter], { [p.id]: p.default }, false));
      if (p.visibleWhen !== undefined && (!object(p.visibleWhen) || !c.parameters.some((other: any) => other.id === p.visibleWhen.parameter && other.id !== p.id && typeof p.visibleWhen.equals === other.type))) errors.push(`Invalid parameter condition: ${p.id}`);
    }
  }
  return errors;
}
