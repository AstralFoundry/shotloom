export function normalizeAssetPath(value: unknown = '') {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

export function joinAssetPath(root: unknown = '', ...parts: unknown[]) {
  const normalizedRoot = normalizeAssetPath(root);
  const joined = [normalizedRoot, ...parts]
    .filter(Boolean)
    .map((part, index) => index ? String(part).replace(/^[/\\]+|[/\\]+$/g, '') : part)
    .join('/');
  if (/^[a-z]:\//i.test(normalizedRoot)) return joined.replace(/\//g, '\\');
  return joined;
}

export function projectAssetRoot(project: any = {}, projectDir: string | null = '') {
  return String(
    project?.library?.assetRootDir
    || project?.series?.assetRootDir
    || (projectDir ? joinAssetPath(projectDir, 'assets') : ''),
  );
}

export function isPathInsideAssetRoot(filePath = '', root = '') {
  const path = normalizeAssetPath(filePath);
  const normalizedRoot = normalizeAssetPath(root);
  if (!path || !normalizedRoot) return false;
  const insensitive = /^[a-z]:\//i.test(path) || /^[a-z]:\//i.test(normalizedRoot);
  const left = insensitive ? path.toLowerCase() : path;
  const right = insensitive ? normalizedRoot.toLowerCase() : normalizedRoot;
  return left === right || left.startsWith(`${right}/`);
}
