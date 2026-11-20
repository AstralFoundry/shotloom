import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { requestMetrics, timed, requestSignal, sharedRead } from '../src/lib/requestMetrics';

test('request timing and streamed JSON size record metadata without recording private data', async () => {
  const app = new Hono(), original = console.log, mode = process.env.NODE_ENV;
  const logs: string[] = [];
  console.log = value => logs.push(String(value)); process.env.NODE_ENV = 'production';
  app.use('*', requestMetrics);
  app.get('/fixture/:id', async c => {
    assert.ok(requestSignal());
    await timed('auth', async () => {});
    return c.json({ text:'私有正文',url:'signed-url-secret' });
  });
  try {
    const response = await app.request('/fixture/private-id?token=private-token', { headers:{cookie:'private-cookie'} });
    const body = await response.text();
    assert.equal(response.status,200); assert.match(response.headers.get('server-timing')!, /auth;dur=/);
    assert.ok(response.headers.get('x-request-id'));
    const record = JSON.parse(logs[0]!);
    assert.equal(record.bytes,Buffer.byteLength(body)); assert.equal(record.route,'/fixture/:id');
    assert.ok(!logs[0]!.includes('private') && !logs[0]!.includes('secret') && !logs[0]!.includes('私有正文'));
  } finally { console.log = original; process.env.NODE_ENV = mode; }
});


test('nested shared reads retain the original deadline instead of renewing fifteen seconds', async () => {
  const app=new Hono();app.use('*',requestMetrics);
  app.get('/fixture',async c=>{
    const now=Date.now;
    let signal!:AbortSignal;
    try {
      const elapsed=now()+14980;
      Date.now=()=>elapsed;
      signal=sharedRead(()=>sharedRead(()=>requestSignal()!));
    }finally{Date.now=now;}
    let timer:ReturnType<typeof setTimeout>|undefined;
    const timedOut=await Promise.race([
      new Promise<boolean>(resolve=>signal.addEventListener('abort',()=>resolve(true),{once:true})),
      new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),1000);}),
    ]);
    clearTimeout(timer);assert.equal(timedOut,true);
    return c.json({ok:true});
  });
  assert.equal((await app.request('/fixture')).status,200);
});

test('background work after a response cannot lend an expired request deadline to a shared read', async () => {
  const app=new Hono();app.use('*',requestMetrics);
  let resume!:()=>void;
  const gate=new Promise<void>(resolve=>{resume=resolve;});
  let background!:Promise<AbortSignal>;
  app.get('/fixture',c=>{
    background=gate.then(()=>{
      const now=Date.now;
      try {
        Date.now=()=>now()+20000;
        assert.equal(requestSignal(),undefined,'completed HTTP work must not constrain independent background reads');
        return sharedRead(()=>requestSignal()!);
      }finally{Date.now=now;}
    });
    return c.json({ok:true});
  });
  await app.request('/fixture');
  resume();
  const signal=await background;
  await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(signal.aborted,false);
});
