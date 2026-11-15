import type { AttachmentStorage } from '../../../harness/host/src/cachedAttachments';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { admin, createSignedUrl, resolveBucket, scopedKey } from './supabase';
import { supabaseError } from './errors';

/** Only provider-validated cache paths can address this user's private content objects. */
export function agentAttachments(userId: string, cacheRoot: string): AttachmentStorage {
  const bucket = resolveBucket('assets');
  function key(path: string) {
    const local = relative(cacheRoot, path).replace(/\\/g, '/');
    if (!local || local === '..' || local.startsWith('../') || isAbsolute(local)) throw new Error('Attachment cache path outside workspace');
    return scopedKey(userId, `agent/${local}`);
  }
  return {
    async publish(path, signal) {
      const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(key(path), { upsert: true });
      if (error) throw supabaseError(error.message);
      const stream = createReadStream(path);
      try {
        const response = await fetch(data.signedUrl, {
          method: 'PUT', headers: { 'content-type': 'application/octet-stream' },
          body: stream, duplex: 'half', signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(120_000)]),
        } as RequestInit & { duplex: 'half' });
        if (!response.ok) throw new Error(`Attachment upload failed: ${response.status}`);
        await response.body?.cancel();
      } finally { stream.destroy(); }
    },
    async restore(path, signal) {
      const objectKey = key(path);
      if (await access(path).then(() => true, () => false)) return;
      const response = await fetch(await createSignedUrl(bucket, objectKey, 300), {
        signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(120_000)]),
      });
      if (!response.ok || !response.body) throw new Error(`Attachment download failed: ${response.status}`);
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await pipeline(Readable.fromWeb(response.body as never), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
        await rename(temporary, path);
      } finally { await rm(temporary, { force: true }); }
    },
  };
}
