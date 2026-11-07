import { getGenerationInputModes, getModelIdsByType, getModelInputCapabilityForRoles } from '@/domain/catalog/ModelCatalog';

/**
 * 局部重绘（涂抹即改）的协议侧定义。
 *
 * 蒙版约定与 OpenAI Images Edit 一致：画布上涂抹的区域在最终 PNG 里是透明的，
 * 其余区域是不透明白色。模型只重画透明区域，所以「涂抹」与提示词必须一起提交。
 */

export const MASK_EDIT_MODE = 'inpaint';

/** 蒙版会作为额外输入发给模型；这句约定写进提示词，避免模型重画整张图。 */
export const MASK_EDIT_PROMPT_PREFIX = '只修改蒙版圈出的区域，其他区域保持不变。';

export function composeMaskEditPrompt(userPrompt: string): string {
  const trimmed = userPrompt.trim();
  return trimmed ? `${MASK_EDIT_PROMPT_PREFIX}\n${trimmed}` : MASK_EDIT_PROMPT_PREFIX;
}

/**
 * 当前模型是否支持蒙版编辑。能力来自模型目录里图片能力的 maskRequired 标记：
 * 只有 `/images/edits` 这类真正接收蒙版的模式才会声明它。
 */
export function maskEditCapabilityFor(model: string): { supported: boolean; modeId: string } {
  const resolved = getModelInputCapabilityForRoles('imageGeneration', model, ['image']);
  return {
    supported: resolved.supported && resolved.capability.supportsMaskEditing,
    modeId: resolved.modeId,
  };
}

/** 派生节点要落在哪一种输入模式上：必须选一个能收图片的模式。 */
export function maskEditInputModeValue(model: string) {
  return getGenerationInputModes(model).find((mode) => mode.maxImages > 0)?.value;
}

/** 局部重绘面板的模型候选：目录里所有声明了蒙版能力的图片模型。 */
export function listMaskEditModels(): string[] {
  return getModelIdsByType('imageGeneration').filter((model) => maskEditCapabilityFor(model).supported);
}
