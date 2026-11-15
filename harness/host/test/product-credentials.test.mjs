import assert from 'node:assert/strict';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { credentialRef, credentialKey } from '@deepseek-ai/dsh-credentials';
import ProductCredentials from '../dist/productCredentials.js';

test('Host credentials stay scoped to its lifetime and configuration never discloses them', async () => {
  const ctx = new Context();
  await ctx.plugin(ProductCredentials);
  try {
    const ref = credentialRef('SHOTLOOM_SESSION');
    await assert.rejects(ctx.credentials.set(ref, ''), /Empty/);
    await ctx.credentials.set(ref, 'private-session');
    assert.equal((await ctx.credentials.resolve(ref)).value, 'private-session');
    assert.equal(JSON.stringify(await ctx.credentials.describe(ref)).includes('private-session'), false);
    await ctx.credentials.unset(ref);
    assert.equal(await ctx.credentials.resolve(ref), undefined);
    const key = credentialKey('test', 'grant');
    await Promise.all([1, 2].map(() => ctx.credentials.modifyRecord(key, async previous => {
      await new Promise(resolve => setTimeout(resolve, 1));
      return { kind: 'grant', payload: { count: (previous?.payload.count || 0) + 1 } };
    })));
    assert.equal((await ctx.credentials.readRecord(key)).payload.count, 2);
    assert.deepEqual(await ctx.credentials.listRecords(), [{ key, kind: 'grant' }]);
    await ctx.credentials.deleteRecord(key);
    assert.equal(await ctx.credentials.readRecord(key), undefined);
  } finally { await ctx.fiber.dispose(); }
});
