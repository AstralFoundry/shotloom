import assert from 'node:assert/strict';
import test from 'node:test';
import {createRendererEnv} from './helpers/rendererSsr.mjs';

async function fixture() {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const calls = [];
  globalThis.__panelStartup = {connect: () => { calls.push('connect'); return pending; }, client: () => calls.push('client'), catalog: () => calls.push('catalog'), bind: () => { calls.push('bind'); throw new Error('Unexpected bind'); }};
  const modules = {
    '../../services/harnessModelConfig': 'export const harnessModelConfig=()=>({});',
    '../../services/browserHarnessTransport': 'export const connectBrowserHarness=()=>globalThis.__panelStartup.connect(),bindBrowserHarness=()=>globalThis.__panelStartup.bind(),respondBrowserTool=()=>{},registerBrowserToolHandler=()=>{};',
    './harnessClient': 'export const initializeHarnessClient=()=>globalThis.__panelStartup.client();',
    '../../store/skillsStore': 'export const loadGlobalSkills=async()=>globalThis.__panelStartup.catalog();',
    '../../store/recipesStore': 'export const loadGlobalRecipes=async()=>globalThis.__panelStartup.catalog();',
    '../../store/settingsStore': 'export const refreshCloudAccountSettings=async()=>globalThis.__panelStartup.catalog();',
  };
  const env=await createRendererEnv({withWindow:true,storage:new Map(),storageMode:'cloud',plugins:[{
    name:'panel-startup-dependencies',enforce:'pre',
    resolveId(source,importer){if(importer?.endsWith('/app/agent-session/harnessIntegration.ts')&&source in modules)return '\0panel:'+source;},
    load(id){if(id.startsWith('\0panel:'))return modules[id.slice(7)];},
  }]});
  return {env,calls,release,async dispose(){await env.dispose();delete globalThis.__panelStartup;}};
}

test('an unmounted panel does not load its client, catalogs or bind a late session',async()=>{
  const f=await fixture();
  try{
    const {openHarnessPanel}=await f.env.load('app/agent-session/harnessIntegration');
    const control=new AbortController();
    const opening=openHarnessPanel('canvas-primary',undefined,undefined,control.signal);
    control.abort();f.release();
    await assert.rejects(opening,error=>error.name==='AbortError');
    assert.deepEqual(f.calls,['connect']);
  }finally{await f.dispose();}
});

test('a project switch during connection cannot start catalogs or bind to the new project',async()=>{
  const f=await fixture();
  try{
    const {store}=await f.env.load('store/projectStore');
    store.project={...store.project,id:'before'};
    const {openHarnessPanel}=await f.env.load('app/agent-session/harnessIntegration');
    const opening=openHarnessPanel('canvas-primary');
    store.project={...store.project,id:'after'};
    f.release();
    await assert.rejects(opening,error=>error.name==='AgentProjectChangedError');
    assert.deepEqual(f.calls,['connect']);
  }finally{await f.dispose();}
});

test('opening a cloud panel refreshes model settings before binding',async()=>{
  const f=await fixture();
  try{
    const {openHarnessPanel}=await f.env.load('app/agent-session/harnessIntegration');
    const opening=openHarnessPanel('canvas-primary');
    f.release();
    await assert.rejects(opening,/Unexpected bind/);
    assert.deepEqual(f.calls,['connect','catalog','catalog','catalog','bind']);
  }finally{await f.dispose();}
});
