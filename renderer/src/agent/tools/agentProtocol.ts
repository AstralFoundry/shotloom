import type { AgentAction, JsonObject } from '../../services/agentTypes';
import type { JsonSchema } from '../core/types';

interface ActionSpec {
  modelVisible?: boolean;
  description?: string;
  fields?: string[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
}

interface ActionContract {
  commonProperties?: Record<string, JsonSchema>;
  actions?: Record<string, ActionSpec>;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function resolveCommonPropertyRefs(value: unknown, commonProperties: Record<string, JsonSchema>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => resolveCommonPropertyRefs(item, commonProperties));
  }
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const match = typeof record.$ref === 'string'
    ? record.$ref.match(/^#\/commonProperties\/([^/]+)$/)
    : null;
  if (match) {
    const referenced = commonProperties[match[1]];
    if (!referenced) throw new Error(`Agent action schema references unknown common property: ${match[1]}`);
    const overrides = Object.fromEntries(Object.entries(record).filter(([key]) => key !== '$ref'));
    return resolveCommonPropertyRefs({ ...cloneJson(referenced), ...overrides }, commonProperties);
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, nested]) => [key, resolveCommonPropertyRefs(nested, commonProperties)]),
  );
}

export function buildAgentActionSchema(
  contractValue: unknown,
  options: { allowedTypes?: readonly string[]; includeHidden?: boolean } = {},
): JsonSchema {
  // 将存储用 Action Contract 编译成模型可见的 oneOf schema。allowedTypes 是
  // 最终暴露边界，modelVisible=false 则用于彻底隐藏内部动作。
  const contract = contractValue as ActionContract;
  const allowed = options.allowedTypes ? new Set(options.allowedTypes) : null;
  const commonProperties = contract.commonProperties || {};
  const branches: JsonSchema[] = [];
  for (const [type, spec] of Object.entries(contract.actions || {})) {
    if (allowed && !allowed.has(type)) continue;
    if (!options.includeHidden && spec.modelVisible === false) continue;
    const properties: Record<string, JsonSchema> = {
      type: { ...cloneJson(commonProperties.type || { type: 'string' }), enum: [type] },
    };
    for (const field of spec.fields || []) {
      const property = spec.properties?.[field] || commonProperties[field];
      if (property) properties[field] = resolveCommonPropertyRefs(property, commonProperties) as JsonSchema;
    }
    branches.push({
      type: 'object', description: spec.description, properties,
      // Existing generation actions intentionally allow runtime defaults even
      // when the storage contract lists fields as required. Connections have
      // no safe default, so expose their endpoints as schema-required.
      required: ['type', ...(schemaRequiredActionTypes.has(type) ? (spec.required || []) : [])],
      additionalProperties: false,
    });
  }
  if (!branches.length) throw new Error('Agent action schema has no visible action branches');
  return { oneOf: branches };
}

export function flattenAgentActionSchema(schema: JsonSchema): JsonSchema {
  const branches = schema.oneOf || [];
  if (!branches.length) {
    if (schema.type !== 'object') throw new Error('Agent tool input schema must be an object');
    return cloneJson(schema);
  }

  const properties: Record<string, JsonSchema> = {};
  for (const branch of branches) {
    if (branch.type !== 'object') throw new Error('Agent action branch must be an object');
    for (const [name, property] of Object.entries(branch.properties || {})) {
      const existing = properties[name];
      if (!existing) {
        properties[name] = cloneJson(property);
        continue;
      }
      if (JSON.stringify(existing) === JSON.stringify(property)) continue;
      if (existing.enum && property.enum && existing.type === property.type) {
        properties[name] = {
          ...existing,
          enum: [...new Set([...existing.enum, ...property.enum])],
        };
        continue;
      }
      properties[name] = { anyOf: [existing, cloneJson(property)] };
    }
  }

  const required = branches
    .map((branch) => branch.required || [])
    .reduce((shared, branchRequired) => shared.filter((name) => branchRequired.includes(name)));
  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

const createActionTypes = new Set([
  'create_gen_node',
  'create_note_node',
  'place_asset_on_canvas',
]);

const schemaRequiredActionTypes = new Set(['connect_nodes']);

function inferActionType(action: AgentAction): string {
  // 兼容模型偶尔省略 type 的情况；只在字段组合没有歧义时推断动作类型。
  if (String(action.type || '').trim()) return String(action.type).trim();
  if (action.source && action.target) return 'connect_nodes';
  if (action.nodeId && (action.position || action.x != null || action.y != null)) return 'move_node';
  if (action.nodeId && action.content != null) return 'update_note_node';
  if (action.nodeId && (action.prompt != null || action.model != null || action.config != null || action.outputSpec != null)) return 'update_gen_config';
  if (action.nodeType || action.prompt != null || action.model != null) return 'create_gen_node';
  if (action.content != null && !action.nodeId) return 'create_note_node';
  return '';
}

function normalizeInputLinks(value: unknown): AgentAction['inputLinks'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [{ nodeId: item.trim() }];
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const link = item as JsonObject;
    const nodeId = String(link.nodeId || link.id || '').trim();
    if (!nodeId) return [];
    const role = String(link.role || '').trim();
    const slot = String(link.slot || '').trim();
    return [{
      nodeId,
      ...(role ? { role: role as AgentAction['role'] } : {}),
      ...(slot ? { slot: slot as AgentAction['slot'] } : {}),
      ...(link.required === false ? { required: false } : {}),
    }];
  });
}

export function normalizeAgentAction(value: unknown, index = 0, batchId = 'agent'): AgentAction {
  const action = cloneJson(value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as AgentAction;
  action.type = inferActionType(action);
  if (createActionTypes.has(action.type)) {
    action.tempId = String(action.tempId || `${batchId}:node:${index + 1}`);
    action.inputLinks = normalizeInputLinks(action.inputLinks);
  }
  if (action.type === 'create_gen_node') action.nodeType = String(action.nodeType || 'imageGeneration');
  if (action.type === 'create_gen_node' || action.type === 'update_gen_config') {
    action.config = action.config && typeof action.config === 'object' && !Array.isArray(action.config) ? action.config : {};
    action.outputSpec = action.outputSpec && typeof action.outputSpec === 'object' && !Array.isArray(action.outputSpec)
      ? action.outputSpec
      : {};
  }
  return action;
}

export function normalizeAgentActions(values: unknown, batchId = 'agent'): AgentAction[] {
  return (Array.isArray(values) ? values : []).map((value, index) => normalizeAgentAction(value, index, batchId));
}
