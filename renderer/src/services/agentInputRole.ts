import { t } from '../i18n/index';
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
  _project: AgentProject,
  source: AgentNode | null | undefined,
  target: AgentNode | null | undefined,
  _requestedRole: AgentInputRole | 'auto' = 'auto',
  _options: ResolveRoleOptions = {},
): AgentInputRole {
  if (!source || !target) return 'textContext';
  if (source.type === 'textGeneration') return 'textContext';

  const resourceKind = String(source.resourceType || source.mimeType || '').toLowerCase();
  if (source.type === 'resource' && resourceKind.includes('text')) return 'textContext';
  const isImage = source.type === 'imageGeneration'
    || (source.type === 'resource' && resourceKind.includes('image'));
  const isVideo = source.type === 'videoGeneration'
    || (source.type === 'resource' && resourceKind.includes('video'));
  const isAudio = source.type === 'audioGeneration'
    || (source.type === 'resource' && resourceKind.includes('audio'));

  // A normal canvas edge is always a real input. Its role comes from the
  // upstream output type; target-model capability is checked before running.
  if (isImage) return 'referenceImage';
  if (isVideo) return 'inputVideo';
  if (isAudio) return 'referenceAudio';
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

  if (!source || !target) return { valid: false, role, error: t('link.missingNode') };
  if (source.id === target.id) return { valid: false, role, error: t('link.self') };
  if (!['textGeneration', 'imageGeneration', 'videoGeneration', 'audioGeneration'].includes(target.type)) {
    return { valid: false, role, error: t('link.targetInput') };
  }

  const resourceKind = String(source.resourceType || source.mimeType || '').toLowerCase();
  const isText = source.type === 'textGeneration'
    || (source.type === 'resource' && resourceKind.includes('text'));
  const isImage = source.type === 'imageGeneration'
    || (source.type === 'resource' && resourceKind.includes('image'));
  const isVideo = source.type === 'videoGeneration'
    || (source.type === 'resource' && resourceKind.includes('video'));
  const isAudio = source.type === 'audioGeneration'
    || (source.type === 'resource' && resourceKind.includes('audio'));
  if (!isText && !isImage && !isVideo && !isAudio) {
    return { valid: false, role, error: t('link.noOutput') };
  }

  if (role === 'textContext') {
    return isText
      ? { valid: true, role }
      : { valid: false, role, error: t('link.textSource') };
  }

  if (role === 'referenceImage') {
    if (!isImage) return { valid: false, role, error: t('link.imageSource') };
  }

  if (role === 'inputVideo') {
    if (!isVideo) return { valid: false, role, error: t('link.videoSource') };
  }

  if (role === 'referenceAudio') {
    if (!isAudio) return { valid: false, role, error: t('link.audioSource') };
  }

  return { valid: true, role };
}
