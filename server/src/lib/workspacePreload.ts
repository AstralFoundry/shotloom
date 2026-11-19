import { readFile } from 'node:fs/promises';

type Chunk = { file: string; name?: string; imports?: string[]; css?: string[] };
const manifest = readFile(new URL('../../../dist/renderer/.vite/manifest.json', import.meta.url), 'utf8').then(value => JSON.parse(value) as Record<string, Chunk>).catch(() => ({} as Record<string, Chunk>));

export function collectWorkspacePreloads(chunks: Record<string, Chunk>): string[] {
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
    if (key === 'index.html' || chunk.name === 'ReactWorkbench' || chunk.name === 'AntdProvider') collect(key);
  }
  return [...files];
}

export async function workspacePreloadFiles() { return collectWorkspacePreloads(await manifest); }

export function workspacePreloadHtml(userId: string, files: string[]) {
  const identity = JSON.stringify(userId).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body><script>
const userId=${identity},files=${JSON.stringify(files)};
const send=value=>window.ReactNativeWebView?.postMessage(JSON.stringify({...value,userId}));
send({type:'workspace-cookie-ready'});
Promise.allSettled(files.map(async file=>{const response=await fetch('/'+file,{cache:'force-cache',credentials:'same-origin'});if(!response.ok)throw new Error('HTTP '+response.status);await response.arrayBuffer();}))
.then(results=>send({type:'workspace-session-ready',loaded:results.filter(r=>r.status==='fulfilled').length,total:files.length,failed:files.filter((_,i)=>results[i].status==='rejected')}));
</script></body></html>`;
}
