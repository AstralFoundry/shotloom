import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
Object.assign(process.env, {
  NODE_ENV:'test',GATEWAY_BASE_URL:'https://gateway.example.com',GATEWAY_CLIENT_ID:'nac_test',GATEWAY_CLIENT_SECRET:'test-secret',GATEWAY_REDIRECT_URI:'http://localhost:5173/api/auth/callback',FRONTEND_URL:'http://localhost:5173',
  SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-service-role',SUPABASE_PUBLISHABLE_KEY:'test-publishable',SESSION_ENCRYPTION_KEY:'11'.repeat(32),
});
const { app } = await import('../src/index');
const { encrypt } = await import('../src/lib/crypto');

test('display caches reduce upstream reads, isolate sessions, honour refresh and still authenticate every request', async () => {
  const original=globalThis.fetch,user=randomUUID(),session=randomUUID();
  let upstream=0,auth=0,revoked=false;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));
    if(url.hostname==='gateway.example.com') { upstream++; assert.ok(init?.signal); return Response.json({sub:'1',app_quota:upstream}); }
    assert.equal(url.pathname.split('/').at(-1),'sessions'); auth++;
    return Response.json(revoked?null:{id:session,user_id:user,owner:{id:user,sub:'1'},access_token_cipher:encrypt('token'),refresh_token_cipher:null,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString()});
  };
  const request=(force=false)=>app.request('/api/auth/account',{headers:{cookie:`shotloom_session=${session}`,...(force?{'cache-control':'no-cache'}:{})}});
  try {
    const first=await request(); assert.equal(first.status,200); assert.ok(first.headers.get('x-request-id'));
    assert.match(first.headers.get('server-timing')!,/auth;dur=/); assert.match(first.headers.get('server-timing')!,/upstream;dur=/);
    for(let i=0;i<10;i++) assert.equal((await request()).status,200);
    assert.equal(upstream,1); assert.equal(auth,11,'display caching cannot cache authorization');
    assert.match((await request()).headers.get('server-timing')!,/hit=1/);
    assert.equal((await request(true)).status,200); assert.equal(upstream,2);
    revoked=true; assert.equal((await request()).status,401); assert.equal(upstream,2);
  } finally {globalThis.fetch=original;}
});


test('cancelling the first page cannot abort a shared session read for the next page', async () => {
  const original=globalThis.fetch,user=randomUUID(),session=randomUUID();
  let auth=0,release!:()=>void;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));
    if(url.hostname==='gateway.example.com')return Response.json({sub:'1',app_quota:10});
    auth++;
    return new Promise((resolve,reject)=>{
      const signal=init?.signal;
      signal?.addEventListener('abort',()=>reject(signal.reason),{once:true});
      release=()=>resolve(Response.json({id:session,user_id:user,owner:{id:user,sub:'1'},access_token_cipher:encrypt('token'),refresh_token_cipher:null,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString()}));
    });
  };
  const cancelled=new AbortController();
  const request=(signal?:AbortSignal)=>app.request('/api/auth/account',{signal,headers:{cookie:`shotloom_session=${session}`}});
  try {
    const first=request(cancelled.signal);
    while(!release)await new Promise(resolve=>setImmediate(resolve));
    const next=request();
    await new Promise(resolve=>setImmediate(resolve));
    cancelled.abort();release();
    assert.equal((await next).status,200);
    await first;
    assert.equal(auth,1,'overlapping auth reads still share one query');
  }finally{globalThis.fetch=original;}
});
