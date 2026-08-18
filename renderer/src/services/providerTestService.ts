/**
 * providerTestService — 接入对话框的「试跑」请求。
 *
 * 复用声明式 Transport 编译和发送真实请求，但把未保存的 baseUrl/apiKey 显式
 * 传入请求，绕过按 providerId 读取本地设置的路径，让用户在保存前验证协议。
 */

import { buildRuntimeContractForModel } from '@/domain/catalog/ModelCatalog';
import type { CatalogModel } from '@/domain/catalog/ModelCatalog';
import { getProviderTransport } from '@/domain/provider/TransportRegistry';
import type { CompileContext } from '@/domain/provider/ProviderTransport';

export interface ProviderTestResult {
  status: string;
  remoteTaskId: string;
  result?: unknown;
  raw?: unknown;
  error?: string;
}

export async function testProviderRequest({
  model,
  baseUrl,
  apiKey,
  prompt,
}: {
  model: CatalogModel;
  baseUrl: string;
  apiKey: string;
  prompt: string;
}): Promise<ProviderTestResult> {
  const contract = buildRuntimeContractForModel(model);
  if (!contract) throw new Error('当前模型协议缺少可编译的 mode');

  const transport = getProviderTransport(contract.provider);
  const context: CompileContext = {
    taskType: contract.nodeType as CompileContext['taskType'],
    model: contract.modelId,
    prompt,
    modelContract: contract,
    params: {},
    timeoutMs: 30000,
  };

  const request = transport.compileRequest(context);
  request.baseUrl = baseUrl;
  request.apiKey = apiKey;

  const task = await transport.submit(request);
  return {
    status: task.status,
    remoteTaskId: task.remoteTaskId,
    result: task.result,
    raw: task.raw,
    error: task.error,
  };
}
