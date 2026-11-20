type Chunk = { file: string; name?: string; imports?: string[]; css?: string[] };
export function collectWorkspacePreloads(chunks: Record<string, Chunk>, names = ['ReactWorkbench', 'AntdProvider', 'CreationView']): string[] {
  const visited = new Set<string>(), files = new Set<string>();
  function collect(key: string) {
    if (visited.has(key) || !chunks[key]) return;
    visited.add(key);
    const chunk = chunks[key];
    for (const file of [chunk.file, ...(chunk.css || [])]) {
      if (/^assets\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(file)) files.add(file);
    }
    for (const dependency of chunk.imports || []) collect(dependency);
  }
  for (const [key, chunk] of Object.entries(chunks)) {
    if (key === 'index.html' || names.includes(chunk.name || '')) collect(key);
  }
  return [...files];
}

