/**
 * TransportRegistry — Provider 传输层注册中心。
 *
 * 所有 Provider 共用声明式协议执行器，差异只存在于模型目录。
 */

import { desktopApi } from '@/services/desktopApi';
import { normalizeRemoteStatus, formatRemoteTaskError } from '@/utils/remoteTaskFormatting';
import type {
  ProviderTransport, ProviderTask, ProviderTaskState,
  CompiledProviderRequest, CompileContext, ResourceRef,
} from './ProviderTransport';
import type { ModelRuntimeContract } from '../catalog/ModelCatalog';
import { firstProtocolValue, normalizeProtocolResponse, protocolInlineImage, protocolKlingContents, protocolMediaContent, protocolMessageVariables, renderProtocolTemplate } from '@/utils/modelProtocol.mjs';
import { multipartArrayFieldName } from '@/utils/modelRequestBody.mjs';
import { providerRequestTimeoutMs } from '@/utils/providerRequestTimeout.mjs';

// ── Unified declarative transport ───────────────────────────────────────────

class DeclarativeProviderTransport implements ProviderTransport {
  readonly provider: string;
  constructor(provider: string) { this.provider = provider; }

  compileRequest(context: CompileContext): CompiledProviderRequest {
    const contract = context.modelContract;
    const inputs = context.modelInputs || {};
    const refs = [...(inputs.referenceImages || []), ...(inputs.images || [])];
    const multipartImageField = multipartArrayFieldName(
      contract.requestFields.multipartImage || contract.requestFields.images || 'image',
      refs.length,
    );
    if (contract.requestTemplate === undefined) throw new Error(`${contract.modelId}/${contract.modeId} 缺少声明式请求模板`);
    return {
      taskType: context.taskType,
      endpointPath: contract.endpoint.path,
      endpointScope: contract.endpoint.scope,
      endpointMethod: contract.endpoint.method,
      providerId: contract.provider || this.provider,
      protocolTemplate: contract.requestTemplate,
      protocolVariables: {
        model: context.model,
        prompt: context.prompt || '',
        messages: [
          { role: 'system', content: '你是文本生成助手。' },
          { role: 'user', content: `${context.prompt || ''}${context.upstreamContext ? `\n\n${context.upstreamContext}` : ''}` },
        ],
        params: context.params || {},
        duration: context.params?.duration || context.duration || contract.defaultDuration,
        aspectRatio: context.params?.aspectRatio || context.aspectRatio || context.ratio,
        ratio: context.params?.ratio || context.ratio || context.aspectRatio || context.params?.aspectRatio,
        resolution: context.params?.resolution || context.resolution,
        fps: context.params?.fps,
      },
      protocolImageRefs: refs,
      inputImages: contract.inputFormat === 'multipart'
        ? refs.map(ref => ({ filePath: ref.filePath || '', fileName: ref.fileName || 'input.png', fieldName: multipartImageField, mimeType: ref.mimeType }))
        : undefined,
      multipart: contract.inputFormat === 'multipart',
      maskResource: context.imageEdit?.maskFile
        ? { filePath: context.imageEdit.maskFile, fileName: 'mask.png', mimeType: 'image/png' }
        : null,
      maskField: contract.requestFields.mask || 'mask',
      headers: contract.headers,
      auth: contract.auth,
      contract,
      signal: context.signal,
      timeoutMs: providerRequestTimeoutMs(context.taskType, context.timeoutMs),
    };
  }

  async submit(request: CompiledProviderRequest): Promise<ProviderTask> {
    const imageContentFormat = request.contract?.requestFields?.imageContentFormat || '';
    const imageUrls = await collectProtocolImageValues(request.protocolImageRefs || [], {
      preferDataUrl: imageContentFormat === 'google-inline',
    });
    const inlineImage = imageContentFormat === 'google-inline'
      ? protocolInlineImage(imageUrls[0])
      : undefined;
    if (imageContentFormat === 'google-inline' && imageUrls.length && !inlineImage) {
      throw new Error(`${request.contract?.modelId || 'Google Veo'} 图生视频需要可读取的本地图片或 Base64 图片`);
    }
    const content = protocolMediaContent({
      prompt: request.protocolVariables?.prompt,
      imageUrls,
      imageRole: request.contract?.requestFields?.imageContentRole,
    });
    const klingContents = imageContentFormat.startsWith('kling-')
      ? protocolKlingContents({
        prompt: request.protocolVariables?.prompt,
        imageUrls,
        imageType: imageContentFormat === 'kling-references' ? 'refer_image' : 'first_frame',
      })
      : undefined;
    const messageVariables = protocolMessageVariables(
      Array.isArray(request.protocolVariables?.messages) ? request.protocolVariables.messages : [],
    );
    const body = renderProtocolTemplate(request.protocolTemplate, {
      ...(request.protocolVariables || {}),
      ...messageVariables,
      imageUrls: imageUrls.length ? imageUrls : undefined,
      imageUrl: imageUrls[0],
      imageObject: imageUrls[0] ? { url: imageUrls[0] } : undefined,
      inlineImage,
      klingContents,
      content,
    });
    const controls = {
      __signal: request.signal, __timeoutMs: request.timeoutMs,
      __providerId: request.providerId,
      __endpointMethod: request.endpointMethod, __endpointPath: request.endpointPath,
      __endpointScope: request.endpointScope, __headers: request.headers, __auth: request.auth,
    };
    // Route by endpoint path pattern
    if (request.endpointPath.includes('/images/')) {
      const data = await desktopApi.model.imageGeneration({
        ...controls,
        __multipart: request.multipart || false,
        __inputImages: request.inputImages || [],
        __imageField: request.inputImages?.[0]?.fieldName || 'image',
        __maskResource: request.maskResource,
        __maskField: request.maskField,
        ...((body as Record<string, unknown>) || {}),
      });
      return this.submittedTask(data, request);
    }
    if (request.taskType === 'videoGeneration' || request.endpointPath.includes('/contents/generations/')) {
      const data = await desktopApi.model.videoGeneration({
        ...controls,
        ...((body as Record<string, unknown>) || {}),
      });
      return this.submittedTask(data, request);
    }
    // Default: chat completion
    const data = await desktopApi.model.chatCompletion({
      ...controls,
      ...((body as Record<string, unknown>) || {}),
    });
    return this.submittedTask(data, request);
  }

  async poll(task: ProviderTask, contract: ModelRuntimeContract): Promise<ProviderTaskState> {
    const encodedTaskId = task.remoteTaskId.split('/').map(encodeURIComponent).join('/');
    const ep = (contract.taskEndpoint?.path || '').replace('{taskId}', encodedTaskId);
    const data = await desktopApi.model.videoTask({
      taskId: task.remoteTaskId, endpointPath: ep,
      endpointScope: contract.taskEndpoint?.scope || 'v1',
      endpointMethod: contract.taskEndpoint?.method || 'GET',
      providerId: contract.provider || this.provider,
      headers: contract.headers,
      auth: contract.auth,
      signal: undefined, timeoutMs: 60000,
    });
    const rawStatus = pickScalar(firstProtocolValue(data, contract.statusPath || ''));
    if (!rawStatus) throw new Error(`${contract.modelId}/${contract.modeId} 的轮询响应缺少状态路径 ${contract.statusPath}`);
    const status = contract.pollStatusMap?.[rawStatus] || normalizeRemoteStatus(rawStatus);
    const progressValue = firstProtocolValue(data, contract.progressPath || '');
    const errorValue = firstProtocolValue(data, contract.errorPath || '');
    return {
      status,
      progress: status === 'completed' ? 100 : Number(progressValue) || 0,
      result: this.protocolResult(data, contract),
      error: pickStr(errorValue),
    };
  }

  private submittedTask(data: Record<string, any>, request: CompiledProviderRequest): ProviderTask {
    const contract = request.contract;
    if (!contract) throw new Error('声明式请求缺少运行时模型契约');
    const tid = contract.isAsync ? pickStr(firstProtocolValue(data, contract.taskIdPath || '')) : '';
    if (contract.isAsync && !tid) throw new Error(`${contract.modelId}/${contract.modeId} 的提交响应缺少任务 ID 路径 ${contract.taskIdPath}`);
    const result = this.protocolResult(data, contract);
    return {
      remoteTaskId: tid,
      status: tid ? 'queued' : 'completed',
      progress: tid ? 0 : 100,
      result,
      error: '',
      raw: data,
    };
  }

  private protocolResult(data: Record<string, any>, contract: ModelRuntimeContract): Record<string, unknown> {
    if (!contract.resultUrlPath && !contract.resultTextPath && !contract.resultBase64Path) throw new Error(`${contract.modelId}/${contract.modeId} 缺少结果路径`);
    return normalizeProtocolResponse(data, contract);
  }
}

async function collectProtocolImageValues(refs: ResourceRef[], { preferDataUrl = false } = {}): Promise<string[]> {
  const values = await Promise.all(refs.map(async (ref) => {
    const direct = pickStr(ref.remoteUrl || ref.url || ref.previewUrl);
    if (direct && !preferDataUrl) return direct;
    if (ref.filePath) {
      try {
        const buffer = await desktopApi.file.readArrayBuffer?.(ref.filePath);
        if (buffer?.byteLength) {
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
          return `data:${ref.mimeType || 'image/png'};base64,${btoa(binary)}`;
        }
      } catch { /* fall through to a remote value when available */ }
    }
    return direct;
  }));
  return [...new Set(values.filter(Boolean))];
}

// ── Registry ─────────────────────────────────────────────────────────────────

const transports = new Map<string, ProviderTransport>();

export function getProviderTransport(provider: string): ProviderTransport {
  const existing = transports.get(provider);
  if (existing) return existing;
  const t: ProviderTransport = new DeclarativeProviderTransport(provider);
  transports.set(provider, t);
  return t;
}

// ── Shared normalize ─────────────────────────────────────────────────────────

const TERMINAL = new Set(['completed', 'failed', 'timeout', 'cancelled', 'error']);
function normStatus(s: string): ProviderTask['status'] {
  const v = normalizeRemoteStatus(s);
  return (TERMINAL.has(v) ? v : 'running') as ProviderTask['status'];
}
function pickStr(v: unknown): string { return typeof v === 'string' ? v.trim() : ''; }
function pickScalar(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  return '';
}

export function normalizeRemoteTask(data: Record<string, unknown> = {}, fallback: Record<string, unknown> = {}): ProviderTask {
  return {
    remoteTaskId: pickStr(data.taskId || data.task_id || data.requestId || data.request_id || data.id || data.remoteTaskId || data.serverTaskId || fallback.remoteTaskId),
    status: normStatus(pickStr(data.status || data.task_status || fallback.status)),
    progress: typeof data.progress === 'number' ? data.progress : 0,
    result: data.result ?? data.output ?? fallback.result,
    error: formatRemoteTaskError(pickStr(data.error || data.fail_reason || data.message || fallback.error)),
    raw: data,
  };
}
