import { defaultGenerationModel } from './defaultGenerationModels.ts';

const DEFAULT_MODEL_KEYS: Record<string, string> = Object.freeze({
  textGeneration: 'defaultTextModel',
  imageGeneration: 'defaultImageModel',
  videoGeneration: 'defaultVideoModel',
});

export function projectDefaultModelKey(nodeType = '') {
  return DEFAULT_MODEL_KEYS[nodeType] || '';
}

export function resolveProjectDefaultModel(settings: any = {}, nodeType = '') {
  const key = projectDefaultModelKey(nodeType);
  const configured = key ? String(settings?.[key] || '').trim() : '';
  return configured || defaultGenerationModel(nodeType);
}
