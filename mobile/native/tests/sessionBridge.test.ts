import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { act, create } from 'react-test-renderer';

test('session bridge reports network failures as recoverable errors and only 401 as login expiry', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const result = await build({ entryPoints: ['renderer/src/app/NativeSessionBridge.tsx'], absWorkingDir: fileURLToPath(new URL('../../..', import.meta.url)), bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react','react/jsx-runtime'], plugins: [{ name: 'bridge-network-fixture', setup(builder) {
    builder.onResolve({ filter: /services\/cloudRequest$/ }, () => ({ path: 'network', namespace: 'fixture' }));
    builder.onResolve({ filter: /^\.\.\/i18n$/ }, () => ({ path: 'i18n', namespace: 'fixture' }));
    builder.onResolve({ filter: /services\/builtInSkills$/ }, () => ({ path: 'skills', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({path}) => ({ contents: path==='network' ? `exports.cloudRequest=path=>globalThis.__bridgeReady?Promise.resolve(path==='/settings/mobile'?{locale:'en-US'}:{id:'fixture-user'}):Promise.reject(Object.assign(new Error('Connection failed'),{status:globalThis.__bridgeStatus}));` : path==='i18n' ? `exports.t=x=>x;exports.getLocale=()=> 'en-US';` : `exports.builtInSkills=[];exports.withoutBuiltInSkills=x=>x;` }));
  } }] });
  const module = { exports: {} as { NativeSessionBridge: React.ComponentType } };
  new Function('require','module','exports',result.outputFiles[0]!.text)(createRequire(import.meta.url),module,module.exports);
  const messages: any[] = [];
  const browser = Object.assign(new EventTarget(), { ReactNativeWebView: { postMessage: (value:string)=>messages.push(JSON.parse(value)) } });
  (globalThis as any).window=browser;
  try {
    for (const [status,type] of [[503,'error'],[undefined,'error'],[401,'login']] as const) {
      messages.length=0;(globalThis as any).__bridgeStatus=status;
      let tree!:ReturnType<typeof create>;
      await act(async()=>{tree=create(React.createElement(module.exports.NativeSessionBridge));});
      assert.equal(messages.length,1);assert.equal(messages[0].type,type);
      await act(async()=>tree.unmount());
    }
    (globalThis as any).__bridgeReady=true; messages.length=0;
    let readyTree!:ReturnType<typeof create>;
    await act(async()=>{readyTree=create(React.createElement(module.exports.NativeSessionBridge));});
    assert.deepEqual(messages,[{type:'ready',userId:'fixture-user',locale:'en-US'}],'native locale comes from the saved account setting before opening any workspace');
    await act(async()=>readyTree.unmount());
  } finally { delete (globalThis as any).window; delete (globalThis as any).__bridgeStatus; delete (globalThis as any).__bridgeReady; }
});

test('the native login gate reports expired or unavailable sessions after a background document reload', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const result = await build({ entryPoints: ['renderer/src/app/CloudSession.tsx'], absWorkingDir: fileURLToPath(new URL('../../..', import.meta.url)), bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react','react/jsx-runtime'], plugins: [{ name: 'gate-network-fixture', setup(builder) {
    builder.onResolve({ filter: /store\/projectStore$/ }, () => ({ path: 'store', namespace: 'fixture' }));
    builder.onResolve({ filter: /services\/cloudRequest$/ }, () => ({ path: 'network', namespace: 'fixture' }));
    builder.onResolve({ filter: /^\.\.\/i18n$/ }, () => ({ path: 'i18n', namespace: 'fixture' }));
    builder.onResolve({ filter: /components\/SocialAuth$/ }, () => ({ path: 'social', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({path}) => ({ contents: path==='network' ? `exports.cloudEnabled=true;exports.cloudOrigin='https://shotloom.0xfiang.com';exports.bindCloudUser=()=>true;exports.readCloudSession=async()=>{const response=await fetch('/api/auth/me');if(!response.ok)throw Object.assign(new Error('Unavailable'),{status:response.status});return (await response.json()).data};` : path==='i18n' ? `exports.t=x=>x;` : `exports.SocialAuth=()=>null;` }));
  } }] });
  const module = { exports: {} as { CloudSession: React.ComponentType<React.PropsWithChildren> } };
  new Function('require','module','exports',result.outputFiles[0]!.text)(createRequire(import.meta.url),module,module.exports);
  const messages: any[] = [];
  const savedFetch = globalThis.fetch;
  (globalThis as any).window=Object.assign(new EventTarget(), { ReactNativeWebView: { postMessage: (value:string)=>messages.push(JSON.parse(value)) } });
  try {
    for (const [path,status,type] of [['/native',401,'login'],['/native',503,'error'],['/',401,undefined]] as const) {
      messages.length=0;(globalThis as any).location={pathname:path,search:''};
      globalThis.fetch=async()=>new Response('{}',{status});
      let tree!:ReturnType<typeof create>;
      await act(async()=>{tree=create(React.createElement(module.exports.CloudSession,null,'native bridge'));});
      assert.equal(messages.length,type ? 1 : 0);
      if(type) assert.equal(messages[0].type,type);
      await act(async()=>tree.unmount());
    }
  } finally { globalThis.fetch=savedFetch;delete (globalThis as any).window;delete (globalThis as any).location; }
});
