import { t } from '../i18n/index.ts';

function safeExtension(value: unknown, fallback = 'dat') {
  const cleaned = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
  return cleaned || fallback;
}

export function extensionForGeneratedFile(file: any = {}, fallback = 'dat') {
  const candidates = [file.name, file.fileName, file.url, file.previewUrl];
  for (const value of candidates) {
    const path = String(value || '').split(/[?#]/)[0] || '';
    const match = path.match(/\.([a-z0-9]{1,10})$/i);
    if (match) return safeExtension(match[1], fallback);
  }
  return safeExtension(fallback);
}

export function semanticOutputFileName(title: unknown, extension: unknown, index = 0, total = 1) {
  const stem = String(title || t('ui.ResourcePreview.text.99045f8e'))
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .slice(0, 96) || t('ui.ResourcePreview.text.99045f8e');
  const suffix = Number(total) > 1 ? `-${Number(index) + 1}` : '';
  return `${stem}${suffix}.${safeExtension(extension)}`;
}
