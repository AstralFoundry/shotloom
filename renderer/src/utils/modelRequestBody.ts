const CONTROL_FIELDS = new Set([
  '__endpointPath', '__endpointScope', '__endpointMethod',
  '__multipart', '__inputImages', '__imageField', '__maskResource', '__maskField',
  '__signal', '__timeoutMs', '__providerId',
  '__headers', '__auth', '__responseEncoding',
  '__agentProtocol',
]);

const MULTIPART_RESOURCE_FIELDS = new Set(['images', 'input_images', 'reference_images']);

export function multipartArrayFieldName(fieldName = 'image', itemCount = 1) {
  const normalized = String(fieldName || 'image');
  if (itemCount <= 1 || normalized.endsWith('[]')) return normalized;
  return `${normalized}[]`;
}

export function modelRequestEntries(body: any = {}, { multipart = false }: { multipart?: boolean } = {}) {
  return Object.entries((body || {}) as Record<string, unknown>).filter(([key, value]) => {
    if (CONTROL_FIELDS.has(key)) return false;
    if (multipart && MULTIPART_RESOURCE_FIELDS.has(key)) return false;
    return value !== undefined;
  });
}

export function modelJsonRequestBody(body: any = {}) {
  return Object.fromEntries(modelRequestEntries(body));
}
