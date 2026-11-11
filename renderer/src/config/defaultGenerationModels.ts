import defaults from './shotloom-defaults.generated.json' with { type: 'json' };

// 模型默认值来自 shotloom.yml；生成文件与模型目录在构建时校验。
export const DEFAULT_GENERATION_MODELS = Object.freeze({
  textGeneration: defaults.models.text,
  imageGeneration: defaults.models.image,
  videoGeneration: defaults.models.video,
});

export function defaultGenerationModel(nodeType: string = ''): string {
  return DEFAULT_GENERATION_MODELS[nodeType as keyof typeof DEFAULT_GENERATION_MODELS] || '';
}
