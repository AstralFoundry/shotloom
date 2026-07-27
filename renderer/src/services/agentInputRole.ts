import type { AgentInputRole, AgentNode, AgentProject } from './agentTypes';

interface ResolveRoleOptions {
  ignoreSourceId?: string;
}

export interface AgentInputRoleValidation {
  valid: boolean;
  role: AgentInputRole;
  error?: string;
}

/**
 * 画布连线阶段解析输入角色。只检查结构有效性（源/目标存在、类型匹配），
 * 不因当前模型能力上限拒绝连线。模型上限在执行阶段由 InputResolver 处理。
 */
export function resolveAgentInputRole(
  project: AgentProject,
  source: AgentNode | null | undefined,
  target: AgentNode | null | undefined,
  _requestedRole: AgentInputRole | 'auto' = 'auto',
  _options: ResolveRoleOptions = {},
): AgentInputRole {
  if (!source || !target) return 'textContext';
  if (['textGeneration', 'note', 'board'].includes(source.type)) return 'textContext';

  const resourceKind = String(source.resourceType || source.mimeType || '').toLowerCase();
  if (source.type === 'resource' && resourceKind.includes('text')) return 'textContext';
  const isImage = source.type === 'imageGeneration'
    || (source.type === 'resource' && resourceKind.includes('image'));
  const isVideo = source.type === 'videoGeneration'
    || (source.type === 'resource' && resourceKind.includes('video'));

  // A normal canvas edge is always a real input. Its role comes from the
  // upstream output type; target-model capability is checked before running.
  if (isImage) return 'referenceImage';
  if (isVideo) return 'inputVideo';
  return 'textContext';
}

/**
 * 画布连线验证：只检查节点结构和输入类型；模型能力在运行前检查。
 */
export function validateAgentInputRole(
  project: AgentProject,
  source: AgentNode | null | undefined,
  target: AgentNode | null | undefined,
  requestedRole: AgentInputRole | 'auto' = 'auto',
): AgentInputRoleValidation {
  const role = resolveAgentInputRole(project, source, target, requestedRole);

  if (!source || !target) return { valid: false, role, error: '连线源节点或目标节点不存在' };
  if (source.id === target.id) return { valid: false, role, error: '节点不能连接自身' };
  if (!['textGeneration', 'imageGeneration', 'videoGeneration', 'audioGeneration'].includes(target.type)) {
    return { valid: false, role, error: '当前下游节点不会读取上游输入' };
  }

  const resourceKind = String(source.resourceType || source.mimeType || '').toLowerCase();
  const isText = ['textGeneration', 'note', 'board'].includes(source.type)
    || (source.type === 'resource' && resourceKind.includes('text'));
  const isImage = source.type === 'imageGeneration'
    || (source.type === 'resource' && resourceKind.includes('image'));
  const isVideo = source.type === 'videoGeneration'
    || (source.type === 'resource' && resourceKind.includes('video'));
  if (!isText && !isImage && !isVideo) {
    return { valid: false, role, error: '当前上游节点没有可传递给下游的文本、图片或视频输出' };
  }

  if (role === 'textContext') {
    return isText
      ? { valid: true, role }
      : { valid: false, role, error: '文本输入必须来自文本节点或文本资源' };
  }

  if (role === 'referenceImage') {
    if (!isImage) return { valid: false, role, error: '引用图片必须来自图片节点或图片资源' };
  }

  if (role === 'inputVideo') {
    if (!isVideo) return { valid: false, role, error: '视频输入必须来自视频节点或视频资源' };
  }

  return { valid: true, role };
}
