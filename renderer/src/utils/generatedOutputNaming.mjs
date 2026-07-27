function safeExtension(value, fallback = 'dat') {
  const cleaned = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
  return cleaned || fallback;
}

export function extensionForGeneratedFile(file = {}, fallback = 'dat') {
  const candidates = [file.name, file.fileName, file.url, file.previewUrl];
  for (const value of candidates) {
    const path = String(value || '').split(/[?#]/)[0];
    const match = path.match(/\.([a-z0-9]{1,10})$/i);
    if (match) return safeExtension(match[1], fallback);
  }
  return safeExtension(fallback);
}

export function semanticOutputFileName(title, extension, index = 0, total = 1) {
  const stem = String(title || '生成结果')
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .slice(0, 96) || '生成结果';
  const suffix = Number(total) > 1 ? `-${Number(index) + 1}` : '';
  return `${stem}${suffix}.${safeExtension(extension)}`;
}
