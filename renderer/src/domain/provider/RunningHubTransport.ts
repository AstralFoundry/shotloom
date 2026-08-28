import workflowTemplate from '../../config/runninghub-minimax-h3-workflow.json';
import { desktopApi } from '@/services/desktopApi';
import { renderProtocolTemplate } from '@/utils/modelProtocol.mjs';
import { providerRequestTimeoutMs } from '@/utils/providerRequestTimeout.mjs';
import {
  buildRunningHubMinimaxH3Workflow,
  runningHubTaskState,
} from '@/utils/runningHubWorkflow.mjs';
import type {
  CompiledProviderRequest,
  CompileContext,
  ProviderTask,
  ProviderTaskState,
  ProviderTransport,
  ResourceRef,
} from './ProviderTransport';
import type { ModelRuntimeContract } from '../catalog/ModelCatalog';

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
  return String(error || '未知错误');
}

function resourceUrl(ref: ResourceRef): string {
  return readText(ref.remoteUrl || ref.url || ref.previewUrl);
}

function resourceMimeType(ref: ResourceRef): string {
  if (readText(ref.mimeType)) return readText(ref.mimeType);
  const name = readText(ref.fileName || ref.filePath).split(/[?#]/)[0].toLowerCase();
  if (/\.jpe?g$/.test(name)) return 'image/jpeg';
  if (/\.png$/.test(name)) return 'image/png';
  if (/\.mp4$/.test(name)) return 'video/mp4';
  if (/\.wav$/.test(name)) return 'audio/wav';
  if (/\.mp3$/.test(name)) return 'audio/mpeg';
  return 'application/octet-stream';
}

async function uploadResource(
  ref: ResourceRef,
  request: CompiledProviderRequest,
): Promise<string> {
  const filePath = readText(ref.filePath);
  const url = resourceUrl(ref);
  if (!filePath && !url) throw new Error(`RunningHub 输入素材缺少真实文件：${ref.title || ref.nodeId || '未知素材'}`);
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
        __baseUrl: request.baseUrl,
        __apiKey: request.apiKey,
      });
      break;
    } catch (error) {
      lastError = thrownMessage(error);
      if (attempt === 1 || request.signal?.aborted) {
        throw new Error(`RunningHub 素材上传失败（${ref.fileName || ref.title || '未知素材'}）：${lastError}`);
      }
    }
  }
  if (!data) throw new Error(`RunningHub 素材上传失败：${lastError || '无响应'}`);
  if (Number(data?.code) !== 0) throw new Error(`RunningHub 素材上传失败：${providerError(data, String(data?.code ?? '响应无错误信息'))}`);
  const fileName = readText(data?.data?.fileName);
  if (!fileName) throw new Error('RunningHub 素材上传响应缺少 fileName');
  return fileName;
}

async function uploadSequentially(refs: ResourceRef[], request: CompiledProviderRequest): Promise<string[]> {
  const fileNames: string[] = [];
  for (const ref of refs) fileNames.push(await uploadResource(ref, request));
  return fileNames;
}

export class RunningHubTransport implements ProviderTransport {
  readonly provider = 'runninghub';

  compileRequest(context: CompileContext): CompiledProviderRequest {
    if (context.modelContract.requestTemplate === undefined) {
      throw new Error(`${context.modelContract.modelId}/${context.modelContract.modeId} 缺少 RunningHub 工作流声明`);
    }
    return {
      taskType: context.taskType,
      endpointPath: context.modelContract.endpoint.path,
      endpointScope: context.modelContract.endpoint.scope,
      endpointMethod: context.modelContract.endpoint.method,
      providerId: this.provider,
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
    });
    const workflowId = readText((request.protocolTemplate as UnknownRecord)?.workflowId);
    if (!workflowId) throw new Error('RunningHub 模型目录缺少 workflowId');
    let data: UnknownRecord;
    try {
      data = await desktopApi.model.videoGeneration({
        workflowId,
        workflow: JSON.stringify(workflow),
        addMetadata: false,
        __providerId: this.provider,
        __endpointMethod: request.endpointMethod,
        __endpointPath: request.endpointPath,
        __endpointScope: request.endpointScope,
        __auth: { type: 'body', name: 'apiKey' },
        __signal: request.signal,
        __timeoutMs: request.timeoutMs,
        __baseUrl: request.baseUrl,
        __apiKey: request.apiKey,
      });
    } catch (error) {
      throw new Error(`RunningHub 工作流提交失败：${thrownMessage(error)}`);
    }
    if (Number(data?.code) !== 0) throw new Error(`RunningHub 工作流提交失败：${providerError(data, String(data?.code ?? '响应无错误信息'))}`);
    const taskId = readText(data?.data?.taskId);
    if (!taskId) throw new Error('RunningHub 工作流提交响应缺少 taskId');
    return { remoteTaskId: taskId, status: 'queued', progress: 0, raw: data, result: { raw: data } };
  }

  async poll(task: ProviderTask, contract: ModelRuntimeContract, signal?: AbortSignal): Promise<ProviderTaskState> {
    const body = renderProtocolTemplate(contract.taskRequestTemplate || {}, { taskId: task.remoteTaskId });
    const data = await desktopApi.model.videoTask({
      taskId: task.remoteTaskId,
      endpointPath: contract.taskEndpoint?.path,
      endpointScope: contract.taskEndpoint?.scope || 'origin',
      endpointMethod: contract.taskEndpoint?.method || 'POST',
      body,
      providerId: this.provider,
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
