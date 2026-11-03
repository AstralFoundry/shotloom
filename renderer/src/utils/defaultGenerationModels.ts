// 目录每次换代会删掉旧模型，默认模型必须跟着换；只在这里声明一次，
// 设置、工程规范化、原生设置兜底与类型元数据消费同一份结果。
export const DEFAULT_GENERATION_MODELS = Object.freeze({
  textGeneration: 'gpt-6-astra',
  imageGeneration: 'gpt-image-2.5-sunburst',
  videoGeneration: 'grok-imagine-video-1.5',
});

export function defaultGenerationModel(nodeType: string = ''): string {
  return DEFAULT_GENERATION_MODELS[nodeType as keyof typeof DEFAULT_GENERATION_MODELS] || '';
}
