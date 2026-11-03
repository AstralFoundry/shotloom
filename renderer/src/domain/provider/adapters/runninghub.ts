import { t } from '../../../i18n/index.ts';
import { mediaExtension, MEDIA_MIME_BY_EXTENSION } from '@/utils/mediaType.ts';
/**
 * RunningHub 适配器 — 第一个不走声明式协议的厂商。
 *
 * 生成前必须把素材逐个上传换取 fileName，再把 ComfyUI 工作流整体提交，响应里的
 * code/taskId 也不是任何通用协议的形状，因此 compile/submit/poll 全部自己实现。
 */

import workflowTemplate from '../../../config/runninghub-minimax-h3-workflow.json';
import { desktopApi } from '@/services/desktopApi';
import { renderProtocolTemplate } from '@/utils/modelProtocol.ts';
import { providerRequestTimeoutMs } from '@/utils/providerRequestTimeout.ts';
import {
  buildRunningHubMinimaxH3Workflow,
  runningHubTaskState,
} from '@/utils/runningHubWorkflow.ts';
import type {
  CompiledProviderRequest, CompileContext, ProviderAdapter,
  ProviderTask, ProviderTaskState, ResourceRef,
} from '../ProviderAdapter';
import type { ModelRuntimeContract } from '../../catalog/ModelCatalog';

type UnknownRecord = Record<string, any>;

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function providerError(payload: UnknownRecord, fallback: string): string {
  const errors = Array.isArray(payload?.errorMessages)
    ? payload.errorMessages.map(readText).filter(Boolean).join('；')
    : '';
  return readText(payload?.msg) || readText(payload?.message) || readText(payload?.errorMessage) || errors || fallback;
}

function thrownMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return String(error || t("provider.copy.5f76edc5de"));
}

function resourceUrl(ref: ResourceRef): string {
  return readText(ref.remoteUrl || ref.url || ref.previewUrl);
}

function resourceMimeType(ref: ResourceRef): string {
  if (readText(ref.mimeType)) return readText(ref.mimeType);
  return MEDIA_MIME_BY_EXTENSION[mediaExtension({ fileName: ref.fileName, filePath: ref.filePath })] || 'application/octet-stream';
}

async function uploadResource(
  ref: ResourceRef,
  request: CompiledProviderRequest,
): Promise<string> {
  const filePath = readText(ref.filePath);
  const url = resourceUrl(ref);
  if (!filePath && !url) throw new Error(t("errors.f69c49731c", { value0: ref.title || ref.nodeId || t("errors.9d20fd8941") }));
  let data: UnknownRecord | undefined;
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      data = await desktopApi.model.imageGeneration({
        __providerId: 'runninghub',
        __endpointMethod: 'POST',
        __endpointPath: '/openapi/v2/media/upload/binary',
        __endpointScope: 'origin',
        __multipart: true,
        __inputImages: [{
          filePath,
          url,
          fileName: ref.fileName || filePath.split(/[\\/]/).pop() || 'asset.bin',
          mimeType: resourceMimeType(ref),
          fieldName: 'file',
        }],
        __imageField: 'file',
        __auth: { type: 'bearer' },
        __signal: request.signal,
        __timeoutMs: request.timeoutMs,
      });
      break;
    } catch (error) {
      lastError = thrownMessage(error);
      if (attempt === 1 || request.signal?.aborted) {
        throw new Error(t("errors.2c33e9ce3e", { value0: ref.fileName || ref.title || t("errors.9d20fd8941"), value1: lastError }));
      }
    }
  }
  if (!data) throw new Error(t("errors.0c3932850e", { value0: lastError || t("errors.585c257481") }));
  if (Number(data?.code) !== 0) throw new Error(t("errors.0c3932850e", { value0: providerError(data, String(data?.code ?? t("errors.ab20e6a009"))) }));
  const fileName = readText(data?.data?.fileName);
  if (!fileName) throw new Error(t("errors.fececc6fe4"));
  return fileName;
}

async function uploadSequentially(refs: ResourceRef[], request: CompiledProviderRequest): Promise<string[]> {
  const fileNames: string[] = [];
  for (const ref of refs) fileNames.push(await uploadResource(ref, request));
  return fileNames;
}

class RunningHubAdapter implements ProviderAdapter {
  readonly id = 'runninghub';
  readonly name = 'RunningHub';
  readonly description = t("provider.copy.cf5cb38935");
  readonly iconId = 'runninghub';
  readonly baseUrl = 'https://www.runninghub.ai';

  compileRequest(context: CompileContext): CompiledProviderRequest {
    if (context.modelContract.requestTemplate === undefined) {
      throw new Error(t("errors.1bd62309bb", { value0: context.modelContract.modelId, value1: context.modelContract.modeId }));
    }
    return {
      taskType: context.taskType,
      endpointPath: context.modelContract.endpoint.path,
      endpointScope: context.modelContract.endpoint.scope,
      endpointMethod: context.modelContract.endpoint.method,
      providerId: this.id,
      protocolTemplate: context.modelContract.requestTemplate,
      protocolVariables: {
        prompt: context.prompt || '',
        params: context.params || {},
        duration: context.params?.duration || context.duration || context.modelContract.defaultDuration,
        aspectRatio: context.params?.aspectRatio || context.aspectRatio,
        resolution: context.params?.resolution || context.resolution,
      },
      protocolImageRefs: context.modelInputs?.images || [],
      protocolVideoRefs: context.modelInputs?.videos || [],
      protocolAudioRefs: context.modelInputs?.audios || [],
      signal: context.signal,
      timeoutMs: providerRequestTimeoutMs(context.taskType, context.timeoutMs),
      contract: context.modelContract,
    };
  }

  async submit(request: CompiledProviderRequest): Promise<ProviderTask> {
    // RunningHub 上传接口按素材逐个确认文件名，避免并发上传导致工作流引用尚未落盘。
    const images = await uploadSequentially(request.protocolImageRefs || [], request);
    const videos = await uploadSequentially(request.protocolVideoRefs || [], request);
    const audios = await uploadSequentially(request.protocolAudioRefs || [], request);
    const variables = request.protocolVariables || {};
    const params = (variables.params || {}) as UnknownRecord;
    const workflow = buildRunningHubMinimaxH3Workflow(workflowTemplate, {
      prompt: variables.prompt,
      duration: Number(variables.duration),
      aspectRatio: String(variables.aspectRatio || params.aspectRatio || ''),
      resolution: String(variables.resolution || params.resolution || ''),
      images,
      videos,
      audios,
    }, request.contract!);
    const workflowId = readText((request.protocolTemplate as UnknownRecord)?.workflowId);
    if (!workflowId) throw new Error(t("errors.89d5995d1f"));
    let data: UnknownRecord;
    try {
      data = await desktopApi.model.videoGeneration({
        workflowId,
        workflow: JSON.stringify(workflow),
        addMetadata: false,
        __providerId: this.id,
        __endpointMethod: request.endpointMethod,
        __endpointPath: request.endpointPath,
        __endpointScope: request.endpointScope,
        __auth: { type: 'body', name: 'apiKey' },
        __signal: request.signal,
        __timeoutMs: request.timeoutMs,
      });
    } catch (error) {
      throw new Error(t("errors.2f9a75ca03", { value0: thrownMessage(error) }));
    }
    if (Number(data?.code) !== 0) throw new Error(t("errors.2f9a75ca03", { value0: providerError(data, String(data?.code ?? t("errors.ab20e6a009"))) }));
    const taskId = readText(data?.data?.taskId);
    if (!taskId) throw new Error(t("errors.ea98ab1a56"));
    return { remoteTaskId: taskId, status: 'queued', progress: 0, raw: data, result: { raw: data } };
  }

  async poll(
    task: ProviderTask,
    contract: ModelRuntimeContract,
    signal?: AbortSignal,
  ): Promise<ProviderTaskState> {
    const body = renderProtocolTemplate(contract.taskRequestTemplate || {}, { taskId: task.remoteTaskId });
    const data = await desktopApi.model.videoTask({
      taskId: task.remoteTaskId,
      endpointPath: contract.taskEndpoint?.path,
      endpointScope: contract.taskEndpoint?.scope || 'origin',
      endpointMethod: contract.taskEndpoint?.method || 'POST',
      body,
      providerId: this.id,
      auth: { type: 'bearer' },
      signal,
      timeoutMs: 60000,
    });
    const state = runningHubTaskState(data);
    if (state.status === 'completed' && state.url) {
      return {
        status: 'completed',
        progress: 100,
        result: { files: [{ url: state.url, name: 'result.mp4', mimeType: 'video/mp4' }], raw: data },
      };
    }
    return {
      status: state.status,
      progress: state.progress,
      ...(state.error ? { error: `RunningHub：${state.error}` } : {}),
    };
  }
}

export const runningHubAdapter = new RunningHubAdapter();
