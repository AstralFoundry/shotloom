import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { requestMetrics,requestSignal } from '../src/lib/requestMetrics';
import { cachedRead, invalidateReads } from '../src/lib/readCache';

test('successful reads coalesce, invalidation fences old loads, failures are not cached', async () => {
  let release!: (value: number) => void;
  const old = cachedRead('user:fixture:models', 1000, () => new Promise<number>(resolve => { release = resolve; }));
  const shared = cachedRead('user:fixture:models', 1000, async () => 99);
  invalidateReads('user:fixture:');
  assert.equal(await cachedRead('user:fixture:models', 1000, async () => 2), 2);
  release(1);
  assert.deepEqual(await Promise.all([old, shared]), [1, 1]);
  assert.equal(await cachedRead('user:fixture:models', 1000, async () => 99), 2);
  assert.equal(await cachedRead('user:other:models', 1000, async () => 3), 3);
  assert.equal(await cachedRead('user:fixture:models', 1000, async () => 4, true), 4);
  await assert.rejects(cachedRead('failure', 1000, async () => { throw new Error('offline'); }));
  assert.equal(await cachedRead('failure', 1000, async () => 5), 5);
  invalidateReads('');
});


test('a shared display load retains its budget when its first HTTP caller disconnects', async () => {
  const app=new Hono();app.use('*',requestMetrics);
  let release!:()=>void,signal:AbortSignal|undefined,loads=0;
  app.get('/fixture',async c=>c.json(await cachedRead('cancelled-page-fixture',1000,()=>{
    loads++;signal=requestSignal();
    return new Promise<number>((resolve,reject)=>{
      signal?.addEventListener('abort',()=>reject(signal?.reason),{once:true});
      release=()=>resolve(42);
    });
  })));
  const cancelled=new AbortController();
  const first=app.request('/fixture',{signal:cancelled.signal});
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  const next=app.request('/fixture');
  await new Promise(resolve=>setImmediate(resolve));
  cancelled.abort();
  const wasAborted=signal?.aborted;
  release();
  assert.equal((await next).status,200);
  await first;
  assert.equal(wasAborted,false);assert.equal(loads,1);invalidateReads('cancelled-page-fixture');
});
