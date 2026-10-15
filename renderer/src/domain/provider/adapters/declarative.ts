/**
 * declarative — 声明式协议适配器的共享实现。
 *
 * 请求骨架全部来自 model-catalog-v2/ 厂商文件的模式声明，因此绝大多数厂商只需要声明元数据
 * 就能工作；只有协议真正不同的厂商才在自己的适配器文件里提供完整实现。
 */

import { desktopApi } from '@/services/desktopApi';
import { normalizeRemoteStatus } from '@/utils/remoteTaskFormatting';
import {
  firstProtocolValue, normalizeProtocolResponse, protocolInlineImage, protocolMessageVariables,
  protocolResultEndpointFile, renderProtocolContentTemplate, renderProtocolTemplate,
} from '@/utils/modelProtocol.mjs';
import { multipartArrayFieldName } from '@/utils/modelRequestBody.mjs';
import { providerRequestTimeoutMs } from '@/utils/providerRequestTimeout.mjs';
import type {
  CompiledProviderRequest, CompileContext, ProviderAdapter,
  ProviderTask, ProviderTaskState, ResourceRef,
} from '../ProviderAdapter';
import type { ModelRuntimeContract } from '../../catalog/ModelCatalog';
import type { DeclarativeAdapterMeta } from './meta';

function pickStr(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickScalar(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return '';
}

async function collectProtocolResourceValues(
  refs: ResourceRef[],
  { preferDataUrl = false, fallbackMimeType = 'application/octet-stream' } = {},
): Promise<string[]> {
  const values = await Promise.all(refs.map(async (ref) => {
    const direct = pickStr(ref.remoteUrl || ref.url || ref.previewUrl);
    const remotelyUsable = /^(https?:|data:)/i.test(direct);
    if (direct && !preferDataUrl && (remotelyUsable || !ref.filePath)) return direct;
    if (ref.filePath) {
      try {
        const buffer = await desktopApi.file.readArrayBuffer?.(ref.filePath);
        if (buffer?.byteLength) {
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
          return `data:${ref.mimeType || fallbackMimeType};base64,${btoa(binary)}`;
        }
      } catch { /* fall through to a remote value when available */ }
    }
    return direct;
  }));
  return [...new Set(values.filter(Boolean))];
}

async function collectProtocolResourceEntries(
  refs: ResourceRef[],
  options: { preferDataUrl?: boolean; fallbackMimeType?: string } = {},
): Promise<Array<{ ref: ResourceRef; value: string }>> {
  const entries = await Promise.all(refs.map(async (ref) => ({
    ref,
    value: (await collectProtocolResourceValues([ref], options))[0] || '',
  })));
  return entries.filter((entry) => Boolean(entry.value));
}

export class DeclarativeAdapter implements ProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly iconId: string;
  readonly baseUrl: string;
  readonly baseUrlRequired?: boolean;

  constructor(meta: DeclarativeAdapterMeta) {
    this.id = meta.id;
    this.name = meta.name;
    this.description = meta.description;
    this.iconId = meta.iconId;
    this.baseUrl = meta.baseUrl;
    this.baseUrlRequired = meta.baseUrlRequired;
  }

  compileRequest(context: CompileContext): CompiledProviderRequest {
    const contract = context.modelContract;
    const inputs = context.modelInputs || {};
    const refs = inputs.images || [];
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
      providerId: this.id,
      protocolTemplate: contract.requestTemplate,
      protocolVariables: {
        model: contract.upstreamModel,
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
      protocolVideoRefs: inputs.videos || [],
      protocolAudioRefs: inputs.audios || [],
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
      responseEncoding: contract.resultBody?.encoding === 'binary' ? 'binary' : 'json',
      contract,
      signal: context.signal,
      timeoutMs: providerRequestTimeoutMs(context.taskType, context.timeoutMs),
    };
  }

  async submit(request: CompiledProviderRequest): Promise<ProviderTask> {
    const imageContentFormat = request.contract?.requestFields?.imageContentFormat || '';
    const imageEntries = await collectProtocolResourceEntries(request.protocolImageRefs || [], {
      preferDataUrl: imageContentFormat === 'google-inline',
      fallbackMimeType: 'image/png',
    });
    const imageUrls = [...new Set(imageEntries.map((entry) => entry.value))];
    const videoEntries = await collectProtocolResourceEntries(request.protocolVideoRefs || [], { fallbackMimeType: 'video/mp4' });
    const audioEntries = await collectProtocolResourceEntries(request.protocolAudioRefs || [], { fallbackMimeType: 'audio/wav' });
    const videoUrls = [...new Set(videoEntries.map((entry) => entry.value))];
    const audioUrls = [...new Set(audioEntries.map((entry) => entry.value))];
    const inlineImage = imageContentFormat === 'google-inline'
      ? protocolInlineImage(imageUrls[0])
      : undefined;
    if (imageContentFormat === 'google-inline' && imageUrls.length && !inlineImage) {
      throw new Error(`${request.contract?.modelId || 'Google Veo'} 图生视频需要可读取的本地图片或 Base64 图片`);
    }
    const imageRoleForSlot = (slot = '') => {
      const fields = request.contract?.requestFields || {};
      if (slot === 'firstFrame') return fields.firstFrameImageContentRole || fields.imageContentRole;
      if (slot === 'lastFrame') return fields.lastFrameImageContentRole || fields.imageContentRole;
      return fields.referenceImageContentRole || fields.imageContentRole;
    };
    const content = renderProtocolContentTemplate(request.contract?.contentTemplate, {
      text: request.protocolVariables?.prompt,
      images: imageEntries.map(({ ref, value }) => ({
        url: value,
        role: imageRoleForSlot(ref.inputSlot),
        slot: ref.inputSlot || '',
      })),
      videos: videoEntries.map(({ ref, value }) => ({
        url: value,
        role: request.contract?.requestFields?.videoContentRole,
        slot: ref.inputSlot || '',
      })),
      audios: audioEntries.map(({ ref, value }) => ({
        url: value,
        role: request.contract?.requestFields?.audioContentRole,
        slot: ref.inputSlot || '',
      })),
    });
    const messageVariables = protocolMessageVariables(
      Array.isArray(request.protocolVariables?.messages) ? request.protocolVariables.messages : [],
    );
    const body = renderProtocolTemplate(request.protocolTemplate, {
      ...(request.protocolVariables || {}),
      ...messageVariables,
      imageUrls: imageUrls.length ? imageUrls : undefined,
      imageUrl: imageUrls[0],
      imageObject: imageUrls[0] ? { url: imageUrls[0] } : undefined,
      imageInputReference: imageUrls[0] ? { image_url: imageUrls[0] } : undefined,
      referenceImageUrls: imageEntries.filter(({ ref }) => !ref.inputSlot || ref.inputSlot === 'reference').map(({ value }) => value),
      firstFrameImageUrl: imageEntries.find(({ ref }) => ref.inputSlot === 'firstFrame')?.value,
      lastFrameImageUrl: imageEntries.find(({ ref }) => ref.inputSlot === 'lastFrame')?.value,
      videoUrls: videoUrls.length ? videoUrls : undefined,
      videoUrl: videoUrls[0],
      videoObject: videoUrls[0] ? { url: videoUrls[0] } : undefined,
      audioUrls: audioUrls.length ? audioUrls : undefined,
      audioUrl: audioUrls[0],
      audioObject: audioUrls[0] ? { url: audioUrls[0] } : undefined,
      inlineImage,
      content,
    });
    const controls = {
      __signal: request.signal, __timeoutMs: request.timeoutMs,
      __providerId: request.providerId,
      __endpointMethod: request.endpointMethod, __endpointPath: request.endpointPath,
      __endpointScope: request.endpointScope, __headers: request.headers, __auth: request.auth,
      __responseEncoding: request.responseEncoding,
    };
    if (request.taskType === 'imageGeneration' || request.multipart) {
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
    if (request.taskType === 'videoGeneration') {
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

  async poll(
    task: ProviderTask,
    contract: ModelRuntimeContract,
    signal?: AbortSignal,
  ): Promise<ProviderTaskState> {
    const encodedTaskId = task.remoteTaskId.split('/').map(encodeURIComponent).join('/');
    const ep = (contract.taskEndpoint?.path || '').replace('{taskId}', encodedTaskId);
    const body = contract.taskRequestTemplate === undefined
      ? undefined
      : renderProtocolTemplate(contract.taskRequestTemplate, { taskId: task.remoteTaskId });
    const data = await desktopApi.model.videoTask({
      taskId: task.remoteTaskId, endpointPath: ep,
      endpointScope: contract.taskEndpoint?.scope || 'v1',
      endpointMethod: contract.taskEndpoint?.method || 'GET',
      body,
      providerId: this.id,
      headers: contract.headers,
      auth: contract.auth,
      signal, timeoutMs: 60000,
    });
    const rawStatus = pickScalar(firstProtocolValue(data, contract.statusPath || ''));
    if (!rawStatus) throw new Error(`${contract.modelId}/${contract.modeId} 的轮询响应缺少状态路径 ${contract.statusPath}`);
    const status = contract.pollStatusMap?.[rawStatus] || normalizeRemoteStatus(rawStatus);
    const progressValue = firstProtocolValue(data, contract.progressPath || '');
    const errorValue = firstProtocolValue(data, contract.errorPath || '');
    return {
      status,
      progress: status === 'completed' ? 100 : Number(progressValue) || 0,
      result: status === 'completed'
        ? this.completedProtocolResult(data, contract, task.remoteTaskId)
        : { raw: data },
      error: pickStr(errorValue),
    };
  }

  private submittedTask(data: Record<string, any>, request: CompiledProviderRequest): ProviderTask {
    const contract = request.contract;
    if (!contract) throw new Error('声明式请求缺少运行时模型契约');
    const tid = contract.isAsync ? pickStr(firstProtocolValue(data, contract.taskIdPath || '')) : '';
    if (contract.isAsync && !tid) throw new Error(`${contract.modelId}/${contract.modeId} 的提交响应缺少任务 ID 路径 ${contract.taskIdPath}`);
    const result = contract.isAsync ? { raw: data } : this.protocolResult(data, contract);
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
    if (!contract.resultUrlPath && !contract.resultTextPath && !contract.resultBase64Path && !contract.resultHexPath && !contract.resultBody) {
      throw new Error(`${contract.modelId}/${contract.modeId} 缺少结果来源`);
    }
    return normalizeProtocolResponse(data, contract);
  }

  private completedProtocolResult(
    data: Record<string, any>,
    contract: ModelRuntimeContract,
    remoteTaskId: string,
  ): Record<string, unknown> {
    if (!contract.resultEndpoint?.path) return this.protocolResult(data, contract);
    return protocolResultEndpointFile(contract, remoteTaskId, data)!;
  }
}
