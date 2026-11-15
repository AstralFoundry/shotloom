import dns from 'node:dns/promises';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Readable } from 'node:stream';
import { badRequest, HttpError } from './errors';

export const MAX_MEDIA_BYTES = 500 * 1024 * 1024;
const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) blocked.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) {
  blocked.addSubnet(address, prefix, 'ipv6');
}

export function publicMediaAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

export function remoteMediaUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw badRequest('媒体地址无效'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) throw badRequest('媒体下载仅支持公开 HTTPS 地址');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !publicMediaAddress(host)) throw badRequest('媒体地址不能访问内网');
  url.hash = '';
  return url;
}

/** Check every DNS answer and pin the connection; redirects repeat the same validation. */
export async function remoteMedia(value: string, signal: AbortSignal, range?: string): Promise<Response> {
  if (range && !/^bytes=\d+-\d*$/.test(range)) throw badRequest('媒体 Range 无效');
  const control = AbortSignal.any([signal, AbortSignal.timeout(15 * 60_000)]);
  let url = remoteMediaUrl(value);
  for (let redirects = 0; redirects <= 4; redirects++) {
    const upstream = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      const request = https.get(url, {
        agent: false, signal: control, headers: { accept: '*/*', ...(range ? { range } : {}) },
        lookup(hostname, options, callback) {
          void dns.lookup(hostname, { all: true, order: 'ipv4first' }).then(addresses => {
            if (!addresses.length || addresses.some(item => !publicMediaAddress(item.address))) {
              callback(badRequest('媒体地址不能访问内网'), '', 4); return;
            }
            const address = addresses[0]!;
            if (options.all) callback(null, [address]); else callback(null, address.address, address.family);
          }, () => callback(badRequest('无法解析媒体地址'), '', 4));
        },
      }, resolve);
      request.setTimeout(30_000, () => request.destroy(new Error('Media download stalled')));
      request.on('error', error => reject(error instanceof HttpError ? error : new HttpError(502, 'MEDIA_DOWNLOAD_FAILED', '媒体下载失败，请检查地址或重试')));
    });
    const status = upstream.statusCode || 502;
    if ([301, 302, 303, 307, 308].includes(status)) {
      upstream.destroy();
      if (!upstream.headers.location || redirects === 4) throw badRequest('媒体重定向过多或无效');
      try { url = remoteMediaUrl(new URL(upstream.headers.location, url).href); }
      catch { throw badRequest('媒体重定向目标无效或不能访问'); }
      continue;
    }
    if (status !== 200 && status !== 206) {
      upstream.destroy(); throw new HttpError(502, 'MEDIA_DOWNLOAD_FAILED', `媒体源返回 HTTP ${status}`);
    }
    if (Number(upstream.headers['content-length']) > MAX_MEDIA_BYTES) {
      upstream.destroy(); throw badRequest('媒体文件不能超过 500 MiB');
    }
    const headers = new Headers({ 'Content-Disposition': 'attachment', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'", 'Cache-Control': 'no-store' });
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers[name];
      if (typeof value === 'string') headers.set(name, value);
    }
    if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream');
    const body = Readable.from((async function* () {
      let size = 0;
      try {
        for await (const chunk of upstream) {
          size += chunk.length;
          if (size > MAX_MEDIA_BYTES) throw new Error('Media exceeds 500 MiB');
          yield chunk;
        }
      } finally { upstream.destroy(); }
    })());
    return new Response(Readable.toWeb(body) as ReadableStream<Uint8Array>, { status, headers });
  }
  throw badRequest('媒体重定向无效');
}
