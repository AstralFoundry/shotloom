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
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({path}) => ({ contents: path==='network' ? `exports.cloudRequest=()=>Promise.reject(Object.assign(new Error('Connection failed'),{status:globalThis.__bridgeStatus}));` : path==='i18n' ? `exports.t=x=>x;exports.getLocale=()=> 'en-US';` : `exports.builtInSkills=[];exports.withoutBuiltInSkills=x=>x;` }));
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
  } finally { delete (globalThis as any).window; delete (globalThis as any).__bridgeStatus; }
});
