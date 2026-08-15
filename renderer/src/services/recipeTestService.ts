import { getModelInfo, resolveModelRuntimeContract } from '@/domain/catalog/ModelCatalog';
import { desktopApi } from '@/services/desktopApi';
import {
  getAvailableModelIdsByType,
  getModelCredentialStatus,
  settingsStore,
} from '@/store/settingsStore';

const nodeTypeByGenerationType: Record<string, string> = {
  image: 'imageGeneration',
  video: 'videoGeneration',
  audio: 'audioGeneration',
  text: 'textGeneration',
};

export function compatibleModelsForRecipe(recipe: Record<string, unknown>): string[] {
  const nodeType = nodeTypeByGenerationType[String(recipe?.generationType || '')];
  return nodeType ? getAvailableModelIdsByType(nodeType) : [];
}

function extractText(response: any): string {
  return String(response?.choices?.[0]?.message?.content
    || response?.choices?.[0]?.text
    || response?.content
    || response?.text
    || '').trim();
}

function parseResult(text: string, requiredElements: string[]) {
  const candidate = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const parsed = JSON.parse(candidate);
    return {
      prompt: String(parsed.prompt || '').trim(),
      coveredElements: Array.isArray(parsed.coveredElements) ? parsed.coveredElements.map(String) : [],
      missingElements: Array.isArray(parsed.missingElements) ? parsed.missingElements.map(String) : [],
    };
  } catch {
    return { prompt: text, coveredElements: [], missingElements: requiredElements };
  }
}

export async function testRecipe(recipe: Record<string, any>, intent: string) {
  const model = String(settingsStore.agentPreferredTextModel || '');
  const credential = getModelCredentialStatus(model);
  if (!credential.available) throw new Error(`${credential.message}，无法测试 Recipe`);
  const info = getModelInfo(model);
  const contract = resolveModelRuntimeContract('textGeneration', model, []);
  if (!info || !contract) throw new Error(`文本模型未在统一模型目录中配置：${model}`);
  const controller = new AbortController();
  const requiredElements = Array.isArray(recipe.requiredElements) ? recipe.requiredElements.map(String) : [];
  const response = await desktopApi.model.chatCompletion({
    model: contract.requestModelId,
    messages: [
      {
        role: 'system',
        content: [
          '你是生成提示词 Recipe 的测试器。严格执行被测 Recipe，但不要调用任何工具或真正生成媒体。',
          '返回严格 JSON：{"prompt":"最终提示词","coveredElements":["已覆盖项"],"missingElements":["仍缺少项"]}。',
          'coveredElements 和 missingElements 只能使用给定必需元素中的原文；不得输出 Markdown。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `Recipe 名称：${String(recipe.name || recipe.id || '')}`,
          `Recipe 指令：${String(recipe.systemPrompt || '')}`,
          `必需元素：${requiredElements.join('、') || '无'}`,
          `节点意图：${intent.trim()}`,
        ].join('\n'),
      },
    ],
    __providerId: info.provider,
    __endpointPath: contract.endpoint.path,
    __endpointMethod: contract.endpoint.method,
    __endpointScope: contract.endpoint.scope,
    __signal: controller.signal,
    __timeoutMs: 120000,
  });
  const text = extractText(response);
  if (!text) throw new Error('测试模型没有返回提示词');
  return {
    ...parseResult(text, requiredElements),
    model,
    compatibleModels: compatibleModelsForRecipe(recipe),
  };
}
