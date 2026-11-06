/**
 * 提示词优化器的模型调用。
 *
 * 复用现有文本模型契约与厂商适配器：不新建任务、不写画布，只把结果返回给界面。
 * 调用方可传 AbortSignal 取消；失败抛错，原文保持不变由界面负责。
 */

import { resolveModelRuntimeContract } from '@/domain/catalog/ModelCatalog';
import { getProviderAdapter } from '@/domain/provider/adapters';
import { buildOptimizerInstruction, parseOptimizerResult, type OptimizerMode, type OptimizerReference, type OptimizerResult } from '@/domain/prompt/optimizer';
import { extractGeneratedText } from '@/utils/generatedOutputParsing';
import { getModelCredentialStatus, settingsStore } from '@/store/settingsStore';

type AnyRecord = Record<string, any>;

export interface OptimizePromptInput {
  prompt: string;
  mode: OptimizerMode;
  model?: string;
  targetModel?: string;
  generationType?: 'image' | 'video' | 'audio' | 'text';
  references?: OptimizerReference[];
  signal?: AbortSignal;
}

export async function optimizePrompt(input: OptimizePromptInput): Promise<OptimizerResult> {
  const model = String(input.model || settingsStore.agentPreferredTextModel || '').trim();
  if (!model) throw new Error('promptOptimizer.noModel');
  const credential = getModelCredentialStatus(model);
  if (!credential.available) throw new Error('promptOptimizer.noCredential');

  const contract = resolveModelRuntimeContract('textGeneration', model);
  if (!contract) throw new Error('promptOptimizer.noContract');
  const adapter = getProviderAdapter(contract.provider);
  const instruction = buildOptimizerInstruction({
    mode: input.mode,
    prompt: input.prompt,
    ...(input.references ? { references: input.references } : {}),
    ...(input.targetModel ? { targetModel: input.targetModel } : {}),
    ...(input.generationType ? { generationType: input.generationType } : {}),
  });

  const compiled = adapter.compileRequest({
    taskType: 'textGeneration',
    model,
    prompt: `${instruction.system}\n\n${instruction.user}`,
    modelContract: contract,
    params: {},
    signal: input.signal ?? new AbortController().signal,
    timeoutMs: 120000,
  });

  const task = await adapter.submit(compiled);
  if (task.status === 'failed') throw new Error(task.error || 'promptOptimizer.failed');
  const text = extractGeneratedText(task.result)
    || extractGeneratedText((task.result as AnyRecord)?.raw)
    || extractGeneratedText(task.raw);
  if (!text) throw new Error('promptOptimizer.empty');
  return parseOptimizerResult(text);
}
