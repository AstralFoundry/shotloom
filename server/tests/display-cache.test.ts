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
