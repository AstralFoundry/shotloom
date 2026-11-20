import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from './auth';
import { badRequest, HttpError } from './lib/errors';
import { envelope } from './lib/respond';
import type { AppEnv } from './lib/types';

const origin = 'https://polyfork.dev';
const idSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,159}$/);
const querySchema = z.object({
  q: z.string().trim().max(200).default(''),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(24),
});
const assetSchema = z.object({
  id: idSchema, title: z.string(), free: z.boolean(),
  thumbnail: z.string().nullish(), triangles: z.number().nonnegative().nullish(),
  size_m: z.object({ x: z.number(), y: z.number(), z: z.number() }).nullish(),
  has_skeleton: z.boolean().nullish(),
});
const detailSchema = assetSchema.extend({
  credit: z.string().min(1), license: z.string().min(1),
  download: z.object({ glb: z.string().url() }),
});
const maxBytes = 32 * 1024 * 1024;
let retryAt = 0;
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw badRequest('模型查询参数无效');
  return result.data;
}
async function upstream(path: string, signal: AbortSignal) {
  if (Date.now() < retryAt) throw new HttpError(429, 'POLYFORK_RATE_LIMIT', `Polyfork 请求限流，请在 ${Math.ceil((retryAt - Date.now()) / 1000)} 秒后重试`);
  let response: Response;
  try {
    response = await fetch(`${origin}${path}`, {
      headers: { 'User-Agent': 'Shotloom/ModelLibrary', Accept: '*/*' },
      redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]),
    });
  } catch { throw new HttpError(502, 'POLYFORK_UNAVAILABLE', '无法连接 Polyfork，请稍后重试'); }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 429) {
      const retry = response.headers.get('retry-after');
      const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : Math.ceil((Date.parse(retry || '') - Date.now()) / 1000);
      retryAt = Date.now() + (Number.isFinite(seconds) ? Math.max(1, seconds) : 60) * 1000;
    }
    throw new HttpError(response.status === 404 || response.status === 429 ? response.status : 502,
      'POLYFORK_UPSTREAM', response.status === 429 ? 'Polyfork 请求限流，请稍后重试' : `Polyfork 返回 HTTP ${response.status}`);
  }
  return response;
}
async function readBytes(response: Response, limit: number) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new HttpError(502, 'POLYFORK_SIZE', 'Polyfork 文件超过允许大小');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new HttpError(502, 'POLYFORK_EMPTY', 'Polyfork 未返回文件');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new HttpError(502, 'POLYFORK_SIZE', 'Polyfork 文件超过允许大小');
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'POLYFORK_DOWNLOAD', 'Polyfork 文件传输失败，请重试');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks, length);
}
async function json(path: string, signal: AbortSignal) {
  try { return JSON.parse((await readBytes(await upstream(path, signal), 4 * 1024 * 1024)).toString('utf8')) as unknown; }
  catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'POLYFORK_RESPONSE', 'Polyfork 响应格式无效');
  }
}
async function detail(id: string, signal: AbortSignal) {
  const parsed = detailSchema.safeParse(await json(`/api/assets/${id}`, signal));
  if (!parsed.success) throw new HttpError(502, 'POLYFORK_RESPONSE', 'Polyfork 模型详情无效');
  const asset = parsed.data;
  // Only the free mesh licence covers copies in users' projects and download bundles.
  if (!asset.free || !asset.license.includes('CC BY 4.0') || !asset.credit.includes('CC BY 4.0'))
    throw badRequest('当前只支持允许 CC BY 4.0 分发的免费 GLB 模型');
  if (asset.download.glb !== `${origin}/cdn/${id}.glb` || asset.id !== id)
    throw new HttpError(502, 'POLYFORK_DOWNLOAD', 'Polyfork 模型下载地址无效');
  return { ...asset, source: `${origin}/asset/${id}`, licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' };
}

export const polyforkApp = new Hono<AppEnv>();
polyforkApp.use('/polyfork/*', requireAuth);
polyforkApp.get('/polyfork/assets', async c => {
  const query = parse(querySchema, c.req.query());
  const params = new URLSearchParams({ q: query.q, page: String(query.page), per_page: String(query.per_page), free: '1' });
  const result = z.object({ total: z.number().int().nonnegative(), page: z.number().int().positive(), per_page: z.number().int().positive(), assets: z.array(assetSchema) })
    .safeParse(await json(`/api/assets?${params}`, c.req.raw.signal));
  if (!result.success) throw new HttpError(502, 'POLYFORK_RESPONSE', 'Polyfork 模型列表无效');
  return c.json(envelope({ ...result.data, assets: result.data.assets.filter(asset => asset.free).map(asset => ({ ...asset,
    thumbnail: asset.thumbnail?.startsWith(`${origin}/`) ? asset.thumbnail : null,
  })) }));
});
polyforkApp.get('/polyfork/assets/:id', async c => c.json(envelope(await detail(parse(idSchema, c.req.param('id')), c.req.raw.signal))));
polyforkApp.get('/polyfork/assets/:id/model', async c => {
  const id = parse(idSchema, c.req.param('id'));
  await detail(id, c.req.raw.signal);
  const bytes = await readBytes(await upstream(`/cdn/${id}.glb`, c.req.raw.signal), maxBytes);
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length)
    throw new HttpError(502, 'POLYFORK_GLB', 'Polyfork GLB 文件无效');
  return new Response(bytes, { headers: { 'Content-Type': 'model/gltf-binary', 'Content-Disposition': `attachment; filename="${id}.glb"`, 'Cache-Control': 'no-store' } });
});
