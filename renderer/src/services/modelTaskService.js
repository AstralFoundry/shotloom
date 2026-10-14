/**
 * modelTaskService — 生成任务的薄入口。
 *
 * 请求编译、提交、轮询全部委托给 domain/provider/adapters 下的厂商适配器。
 * 本文件只负责：校验设置 → 解析模型契约 → 取适配器 → 调用管道。
 */

import { getModelCredentialStatus } from '@/store/settingsStore';
import { getProviderAdapter } from '@/domain/provider/adapters';

export function imageRequestUsesMultipart(payload = {}) {
  return payload.modelContract?.inputFormat === 'multipart';
}

function requireModelContract(payload = {}) {
  const contract = payload.modelContract;
  if (!contract || contract.catalogVersion !== 2 || contract.modelId !== payload.model) {
    throw new Error(`生成请求缺少 ${payload.model || '未知模型'} 的 v2 modelContract`);
  }
  return contract;
}

/**
 * 提交远程生成任务。编译 → 提交 → 归一化 管道。
 */
export async function submitRemoteGenerationTask({ task, payload, signal }) {
  const contract = requireModelContract(payload);
  const credentialStatus = getModelCredentialStatus(contract.modelId);
  if (!credentialStatus.available) {
    throw new Error(`${credentialStatus.message}，请先在设置 → API 厂商中完成配置`);
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
  };

  const result = await adapter.submit(adapter.compileRequest(context));

  // Async task validation
  if (result.remoteTaskId && !result.remoteTaskId.startsWith('mock-')) {
    if (!contract.isAsync || !contract.taskEndpoint?.path) {
      throw new Error(`${contract.modelId}/${contract.modeId} 返回了异步任务，但 v2 catalog 未声明 taskEndpoint`);
    }
  }

  return result;
}

/**
 * 轮询远程异步任务状态。
 */
export async function pollRemoteGenerationTask({ remoteTaskId, modelContract, signal }) {
  if (!remoteTaskId || remoteTaskId.startsWith('mock-')) {
    return { remoteTaskId: remoteTaskId || '', status: 'completed', progress: 100 };
  }
  if (signal?.aborted) throw new DOMException('任务查询已取消', 'AbortError');
  if (!modelContract?.isAsync || !modelContract.taskEndpoint?.path) {
    throw new Error('缺少 v2 catalog 异步轮询契约');
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
 *
 * @param {{remoteTaskId?: string, modelContract?: object}} params
 * @returns {Promise<boolean>} 是否已向远端确认取消
 */
export async function cancelRemoteGenerationTask({ remoteTaskId, modelContract } = {}) {
  if (!remoteTaskId) return true;
  const cancelEndpoint = modelContract?.cancelEndpoint;
  if (!cancelEndpoint?.path) return false;
  const adapter = getProviderAdapter(modelContract.provider);
  if (!adapter.cancel) return false;
  await adapter.cancel({ remoteTaskId });
  return true;
}
