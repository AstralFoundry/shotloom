import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { MAX_MEDIA_BYTES, publicMediaAddress, remoteMediaUrl, remoteMedia } from '../src/lib/remoteMedia';

test('remote media accepts public HTTPS and rejects non-public IP forms', () => {
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(publicMediaAddress(address), true, address);
  for (const address of ['0.0.0.0', '10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1',
    '192.168.1.1', '100.64.0.1', '198.18.0.1', '224.0.0.1', '::1', '::ffff:127.0.0.1',
    'fc00::1', 'fe80::1', '2002:7f00:1::', '2001:db8::1']) assert.equal(publicMediaAddress(address), false, address);
  assert.equal(remoteMediaUrl('https://cdn.example/file?signature=secret').search, '?signature=secret');
  for (const url of ['file:///etc/passwd', 'http://example.com/x', 'https://user:pass@example.com/x',
    'https://example.com:8443/x', 'https://2130706433/x', 'https://[::ffff:127.0.0.1]/x']) assert.throws(() => remoteMediaUrl(url));
});

test('a hostname resolving to private or mixed addresses is refused before connection', async t => {
  for (const addresses of [[{ address: '127.0.0.1', family: 4 }],
    [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]]) {
    const lookup = t.mock.method(dns, 'lookup', async () => addresses);
    await assert.rejects(remoteMedia('https://cdn.example/video', new AbortController().signal), /内网/);
    assert.equal(lookup.mock.callCount(), 1);
    lookup.mock.restore();
  }
});

test('download pins DNS, streams only media headers and rechecks redirects and length', async t => {
  t.mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  let status = 200;
  let headers: Record<string, string> = { 'content-type': 'video/mp4', 'set-cookie': 'secret=do-not-forward' };
  let captured: https.RequestOptions | undefined;
  t.mock.method(https, 'get', (_url, options, callback) => {
    captured = options;
    const request = Object.assign(new EventEmitter(), { setTimeout() { return this; } });
    queueMicrotask(() => callback(Object.assign(Readable.from([Buffer.from('video')]), { statusCode: status, headers })));
    return request;
  });
  const response = await remoteMedia('https://cdn.example/video?signature=secret', new AbortController().signal);
  assert.equal(await response.text(), 'video');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('content-type'), 'video/mp4');
  assert.match(response.headers.get('content-security-policy')!, /sandbox/);
  assert.equal(captured!.agent, false);
  assert.deepEqual(captured!.headers, { accept: '*/*' });
  const pinned = await new Promise(resolve => captured!.lookup!('cdn.example', { all: true }, (_error, result) => resolve(result)));
  assert.deepEqual(pinned, [{ address: '8.8.8.8', family: 4 }]);
  status = 302; headers = { location: 'https://127.0.0.1/private' };
  await assert.rejects(remoteMedia('https://cdn.example/video', new AbortController().signal), /重定向/);
  status = 200; headers = { 'content-length': String(MAX_MEDIA_BYTES + 1) };
  await assert.rejects(remoteMedia('https://cdn.example/video', new AbortController().signal), /500 MiB/);
});
