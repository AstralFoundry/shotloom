const origin = 'https://polyfork.dev';
const maxModelBytes = 32 * 1024 * 1024;
export const polyforkPrefix = '/api/polyfork/';
let retryAt = 0;

class PolyforkError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function upstream(path: string, signal: AbortSignal) {
  if (Date.now() < retryAt) throw new PolyforkError(429, `Polyfork 请求限流，请在 ${Math.ceil((retryAt - Date.now()) / 1000)} 秒后重试`);
  let response: Response;
  try {
    response = await fetch(`${origin}${path}`, {
      headers: { 'User-Agent': 'Shotloom/ModelLibrary', Accept: '*/*' },
      redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
    });
  } catch { throw new PolyforkError(502, '无法连接 Polyfork，请稍后重试'); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 429) {
      const retry = response.headers.get('retry-after');
      const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : Math.ceil((Date.parse(retry || '') - Date.now()) / 1000);
      retryAt = Date.now() + (Number.isFinite(seconds) ? Math.max(1, seconds) : 60) * 1000;
    }
    throw new PolyforkError([404, 429].includes(response.status) ? response.status : 502, `Polyfork 返回 HTTP ${response.status}`);
  }
  return response;
}

async function readBytes(response: Response, limit: number) {
  const tooLarge = () => new PolyforkError(502, 'Polyfork 文件超过允许大小');
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  const reader = response.body?.getReader();
  if (!reader) throw new PolyforkError(502, 'Polyfork 未返回文件');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw tooLarge();
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof PolyforkError) throw error;
    throw new PolyforkError(502, 'Polyfork 文件传输失败，请重试');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const validId = /^[a-z0-9][a-z0-9-]{0,159}$/;
const invalidResponse = () => new PolyforkError(502, 'Polyfork 响应格式无效');
const positiveInt = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

async function json(path: string, signal: AbortSignal) {
  const bytes = await readBytes(await upstream(path, signal), 4 * 1024 * 1024);
  try { return record(JSON.parse(bytes.toString('utf8'))); }
  catch { throw invalidResponse(); }
}

function assetSummary(asset: Record<string, unknown>) {
  const { id, title, free, thumbnail, triangles, has_skeleton } = asset;
  if (typeof id !== 'string' || !validId.test(id) || typeof title !== 'string' || typeof free !== 'boolean') throw invalidResponse();
  const { x, y, z } = record(asset.size_m);
  return {
    id, title, free,
    class: typeof asset.class === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(asset.class) ? asset.class : null,
    thumbnail: typeof thumbnail === 'string' && thumbnail.startsWith(`${origin}/`) ? thumbnail : null,
    triangles: typeof triangles === 'number' && Number.isFinite(triangles) && triangles >= 0 ? triangles : null,
    has_skeleton: typeof has_skeleton === 'boolean' ? has_skeleton : null,
    size_m: typeof x === 'number' && typeof y === 'number' && typeof z === 'number' && [x, y, z].every(Number.isFinite) ? { x, y, z } : null,
  };
}

async function detail(id: string, signal: AbortSignal) {
  const asset = await json(`/api/assets/${id}`, signal);
  const summary = assetSummary(asset);
  const { credit, license } = asset;
  if (!summary.free || typeof credit !== 'string' || !credit.includes('CC BY 4.0') || typeof license !== 'string' || !license.includes('CC BY 4.0'))
    throw new PolyforkError(400, '当前只支持允许 CC BY 4.0 分发的免费 GLB 模型');
  const glb = `${origin}/cdn/${id}.glb`;
  if (summary.id !== id || record(asset.download).glb !== glb) throw new PolyforkError(502, 'Polyfork 模型下载地址无效');
  return { ...summary, credit, license, download: { glb }, source: `${origin}/asset/${id}`, licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' };
}

const noStore = { 'Cache-Control': 'no-store' };
const success = (data: unknown) => Response.json({ success: true, data }, { headers: noStore });

export async function handlePolyforkRequest(request: Request): Promise<Response> {
  try {
    if (request.method !== 'GET') throw new PolyforkError(405, '仅支持读取在线模型');
    const fetchSite = request.headers.get('sec-fetch-site');
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') throw new PolyforkError(403, '在线模型接口仅供当前应用使用');
    const url = new URL(request.url);
    if (url.pathname === `${polyforkPrefix}assets`) {
      const q = (url.searchParams.get('q') ?? '').trim();
      const page = Number(url.searchParams.get('page') ?? '1');
      const pageSize = Number(url.searchParams.get('per_page') ?? '24');
      if (q.length > 200 || !positiveInt(page) || page > 10_000 || !positiveInt(pageSize) || pageSize > 100)
        throw new PolyforkError(400, '模型查询参数无效');
      const params = new URLSearchParams({ q, page: String(page), per_page: String(pageSize), free: '1' });
      const result = await json(`/api/assets?${params}`, request.signal);
      const { total, page: currentPage, per_page: perPage, assets } = result;
      if ((total !== 0 && !positiveInt(total)) || !positiveInt(currentPage) || !positiveInt(perPage) || !Array.isArray(assets)) throw invalidResponse();
      return success({ total, page: currentPage, per_page: perPage, assets: assets.map(asset => assetSummary(record(asset))).filter(asset => asset.free) });
    }
    const match = /^\/api\/polyfork\/assets\/([^/]+)(\/model)?$/.exec(url.pathname);
    if (!match) throw new PolyforkError(404, '在线模型接口不存在');
    const [, id, model] = match;
    if (!validId.test(id)) throw new PolyforkError(400, 'Polyfork 模型 ID 无效');
    const asset = await detail(id, request.signal);
    if (!model) return success(asset);
    const bytes = await readBytes(await upstream(`/cdn/${id}.glb`, request.signal), maxModelBytes);
    if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length)
      throw new PolyforkError(502, 'Polyfork GLB 文件无效');
    return new Response(bytes, { headers: { ...noStore, 'Content-Type': 'model/gltf-binary' } });
  } catch (error) {
    const failure = error instanceof PolyforkError ? error : new PolyforkError(502, '在线模型请求失败，请稍后重试');
    return Response.json({ success: false, message: failure.message }, { status: failure.status, headers: noStore });
  }
}
