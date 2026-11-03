import { t } from '../i18n/index.ts';
/**
 * modelTaskService — 生成任务的薄入口。
 *
 * 请求编译、提交、轮询全部委托给 domain/provider/adapters 下的厂商适配器。
 * 本文件只负责：校验设置 → 解析模型契约 → 取适配器 → 调用管道。
 */

import { getModelCredentialStatus } from '@/store/settingsStore';
import { getProviderAdapter } from '@/domain/provider/adapters';
import type { ModelRuntimeContract } from '@/domain/catalog/ModelCatalog';
import type {
  CompileContext,
  ProviderTask,
  ProviderTaskState,
} from '@/domain/provider/ProviderAdapter';

// 请求载荷是画布与任务记录里持久化的松散 JSON：字段是否出现取决于节点类型与厂商。
type AnyRecord = Record<string, any>;

function requireModelContract(payload: AnyRecord = {}): ModelRuntimeContract {
  const contract = payload.modelContract;
  if (!contract || contract.catalogVersion !== 2 || contract.modelId !== payload.model) {
    throw new Error(t("errors.980e7976d6", { value0: payload.model || t("errors.8b2303608f") }));
  }
  return contract as ModelRuntimeContract;
}

/**
 * 提交远程生成任务。编译 → 提交 → 归一化 管道。
 */
export async function submitRemoteGenerationTask({
  task,
  payload,
  signal,
}: { task: AnyRecord; payload: AnyRecord; signal: AbortSignal }): Promise<ProviderTask> {
  const contract = requireModelContract(payload);
  const credentialStatus = getModelCredentialStatus(contract.modelId);
  if (!credentialStatus.available) {
    throw new Error(t("errors.1c827b494a", { value0: credentialStatus.message }));
  }
  const adapter = getProviderAdapter(contract.provider);

  const context = {
    taskType: task.type,
    model: payload.model,
    prompt: payload.prompt || payload.content || '',
    modelContract: contract,
    modelInputs: payload.modelInputs,
    params: payload,
    signal,
    timeoutMs: task.timeoutMs,
    upstreamContext: payload.upstreamContext,
    imageEdit: payload.imageEdit || null,
    resolution: payload.resolution,
    duration: payload.duration,
    aspectRatio: payload.aspectRatio,
    ratio: payload.ratio,
    inputStrategy: payload.inputStrategy,
    style: payload.style,
    instrumental: payload.instrumental,
    multipart: contract.inputFormat === 'multipart',
  } satisfies CompileContext;

  const result = await adapter.submit(adapter.compileRequest(context));

  // Async task validation
  if (result.remoteTaskId) {
    if (!contract.isAsync || !contract.taskEndpoint?.path) {
      throw new Error(t("errors.6762a72817", { value0: contract.modelId, value1: contract.modeId }));
    }
  }

  return result;
}

/**
 * 轮询远程异步任务状态。
 */
export async function pollRemoteGenerationTask({
  remoteTaskId,
  modelContract,
  signal,
}: { remoteTaskId?: string; modelContract?: ModelRuntimeContract; signal?: AbortSignal }): Promise<ProviderTaskState> {
  if (!remoteTaskId) throw new Error(t("errors.53dbed9ae9"));
  if (signal?.aborted) throw new DOMException(t("errors.b94b06f3ae"), 'AbortError');
  if (!modelContract?.isAsync || !modelContract.taskEndpoint?.path) {
    throw new Error(t("errors.6a97d63d1f"));
  }
  return getProviderAdapter(modelContract.provider)
    .poll({ remoteTaskId, status: 'running', progress: 0 }, modelContract, signal);
}

/**
 * 取消远程生成任务。
 *
 * 同步（非 async）模型请求由调用方通过 AbortSignal 中止，AbortSignal 会一路传到
 * Tauri 的 generation_request，由 Rust 端 generation_cancel 终止上游 HTTP 请求。
 *
 * 异步任务（remoteTaskId 非空）只能在目录声明了 cancel 端点时才能通知上游；
 * 当前 model-catalog-v2 没有 cancelEndpoint 定义，此时返回 false 让调用方如实
 * 提示用户“仅取消本地等待，上游任务仍在运行”，而不是假装成功。
 */
export async function cancelRemoteGenerationTask({
  remoteTaskId,
  modelContract,
}: { remoteTaskId?: string; modelContract?: AnyRecord } = {}): Promise<boolean> {
  if (!remoteTaskId) return true;
  const cancelEndpoint = modelContract?.cancelEndpoint;
  if (!cancelEndpoint?.path) return false;
  const adapter = getProviderAdapter(modelContract?.provider);
  if (!adapter.cancel) return false;
  await adapter.cancel({ remoteTaskId });
  return true;
}
