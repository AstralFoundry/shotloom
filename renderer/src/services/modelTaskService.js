/**
 * modelTaskService — 生成任务的薄入口。
 *
 * 所有请求编译、提交、轮询和结果归一化委托给 domain/provider/ 下的 Transport。
 * 本文件只负责：校验设置 → 解析模型契约 → 获取 transport → 调用管道。
 */

import { desktopApi } from '@/services/desktopApi';
import { getModelCredentialStatus } from '@/store/settingsStore';
import { getProviderTransport, normalizeRemoteTask } from '@/domain/provider/TransportRegistry';

export { normalizeRemoteTask } from '@/domain/provider/TransportRegistry';

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
  const transport = getProviderTransport(contract.provider);

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

  const req = transport.compileRequest(context);
  // Inject providerId into body so the Rust HTTP layer routes to correct key
  if (req.body && typeof req.body === 'object') {
    req.body.__providerId = req.providerId;
  }
  const result = await transport.submit(req);

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
    return normalizeRemoteTask({ id: remoteTaskId, status: 'completed', progress: 100 });
  }
  if (signal?.aborted) throw new DOMException('任务查询已取消', 'AbortError');
  if (!modelContract?.isAsync || !modelContract.taskEndpoint?.path) {
    throw new Error('缺少 v2 catalog 异步轮询契约');
  }
  const transport = getProviderTransport(modelContract.provider);
  if (!transport.poll) {
    // Fallback: generic poll via desktopApi
    const data = await desktopApi.model.videoTask({
      taskId: remoteTaskId,
      endpointPath: modelContract.taskEndpoint.path,
      endpointScope: modelContract.taskEndpoint.scope,
      endpointMethod: modelContract.taskEndpoint.method,
      providerId: modelContract.provider,
      signal, timeoutMs: 60000,
    });
    return normalizeRemoteTask(data, { remoteTaskId, status: 'running' });
  }
  return transport.poll({ remoteTaskId, status: 'running', progress: 0 }, modelContract, signal);
}

export async function cancelRemoteGenerationTask({ remoteTaskId }) {
  return false;
}
