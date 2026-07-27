const DEFAULT_MODEL_KEYS = Object.freeze({
  textGeneration: 'defaultTextModel',
  imageGeneration: 'defaultImageModel',
  videoGeneration: 'defaultVideoModel',
});

const FALLBACK_MODELS = Object.freeze({
  textGeneration: 'gpt-5.4',
  imageGeneration: 'gpt-image-2',
  videoGeneration: 'grok-imagine-video',
});

export function projectDefaultModelKey(nodeType = '') {
  return DEFAULT_MODEL_KEYS[nodeType] || '';
}

export function resolveProjectDefaultModel(settings = {}, nodeType = '') {
  const key = projectDefaultModelKey(nodeType);
  const configured = key ? String(settings?.[key] || '').trim() : '';
  return configured || FALLBACK_MODELS[nodeType] || '';
}

