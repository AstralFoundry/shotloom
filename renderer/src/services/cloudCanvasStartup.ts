import { cloudRequest, cloudUserHeaders } from './cloudRequest';

type RecordValue = Record<string, unknown>;
type CanvasStartup = { project: RecordValue; settings: RecordValue; assets: RecordValue };
let startup: { key: string; consumed: Set<keyof CanvasStartup>; read?: Promise<CanvasStartup | null> } | undefined;

export function cloudProjectId(path: string): string {
  const id = path.replace(/\\/g, '/').replace(/\/project\.sqlite$/, '').split('/').at(-1) || '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid cloud project reference');
  return id;
}

function canvasStartupRead(projectPath?: string) {
  const query = new URLSearchParams(typeof window === 'undefined' ? '' : window.location?.search);
  const requested = query.get('project');
  let id: string | undefined;
  try { if (requested) id = cloudProjectId(requested); } catch { /* Invalid links use normal reads. */ }
  if (!id || (query.get('native') !== 'embedded' && query.get('route') !== 'creation')
    || (projectPath && projectPath !== `/project/${id}`)) return;
  const key = JSON.stringify([id, cloudUserHeaders()]);
  if (!startup || startup.key !== key) {
    startup = {
      key, consumed: new Set(),
      read: cloudRequest<CanvasStartup>(`/project/${id}/startup`).catch(error => {
        // Older servers keep serving the existing endpoints during a rolling deployment.
        if (error.status === 404 || error.status === 405) return null;
        throw error;
      }),
    };
  }
  return startup;
}

// Start data reads while the workbench code downloads, without loading that code here.
export function preloadCloudCanvasStartup() {
  void canvasStartupRead()?.read?.catch(() => {});
}

export async function readCanvasStartup<T>(part: keyof CanvasStartup, path: string): Promise<T> {
  const value = canvasStartupRead(part === 'project' ? path : undefined);
  if (!value || value.consumed.has(part)) return cloudRequest<T>(path);
  // Consume before awaiting: only the first startup read may reuse this response.
  value.consumed.add(part);
  const read = value.read!;
  if (value.consumed.size === 3) delete value.read;
  const data = await read;
  return data ? data[part] as T : cloudRequest<T>(path);
}
