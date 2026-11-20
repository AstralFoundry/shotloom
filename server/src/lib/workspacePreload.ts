import { readFile } from 'node:fs/promises';

import { collectWorkspacePreloads } from '../../../shared/workspacePreloads';
export { collectWorkspacePreloads } from '../../../shared/workspacePreloads';

export async function workspacePreloadFiles(directory = new URL('../../../dist/renderer/', import.meta.url)) {
  try {
    const html = await readFile(new URL('index.html', directory), 'utf8');
    const entry = html.match(/<script\b[^>]*\bsrc=["']\.\/(assets\/[^"']+\.js)["']/)?.[1];
    const embedded = html.match(/<script id="shotloom-workspace-preloads" type="application\/json">([^<]*)<\/script>/)?.[1];
    const files: unknown = embedded ? JSON.parse(embedded) : collectWorkspacePreloads(JSON.parse(await readFile(new URL('.vite/manifest.json', directory), 'utf8')));
    if (Array.isArray(files) && entry && files.includes(entry) && files.every(file => typeof file === 'string' && /^assets\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(file))) return files as string[];
    console.warn('[workspace-preload] Page and preload metadata do not match');
  } catch { console.warn('[workspace-preload] Preload metadata unavailable'); }
  return [];
}

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
