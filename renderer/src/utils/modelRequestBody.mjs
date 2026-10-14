const CONTROL_FIELDS = new Set([
  '__endpointPath', '__endpointScope', '__endpointMethod',
  '__multipart', '__inputImages', '__imageField', '__maskResource', '__maskField',
  '__signal', '__timeoutMs', '__providerId',
  '__headers', '__auth', '__responseEncoding',
]);

const MULTIPART_RESOURCE_FIELDS = new Set(['images', 'input_images', 'reference_images']);

export function multipartArrayFieldName(fieldName = 'image', itemCount = 1) {
  const normalized = String(fieldName || 'image');
  if (itemCount <= 1 || normalized.endsWith('[]')) return normalized;
  return `${normalized}[]`;
}

export function modelRequestEntries(body = {}, { multipart = false } = {}) {
  return Object.entries(body || {}).filter(([key, value]) => {
    if (CONTROL_FIELDS.has(key)) return false;
    if (multipart && MULTIPART_RESOURCE_FIELDS.has(key)) return false;
    return value !== undefined;
  });
}

export function modelJsonRequestBody(body = {}) {
  return Object.fromEntries(modelRequestEntries(body));
}
