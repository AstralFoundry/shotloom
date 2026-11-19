import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from './helpers/sourceContract.mjs';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

function startup(dependencies, search = '?native=embedded&project=fixture', cloudEnabled = true) {
  const source = readSource('renderer/src/app/ReactWorkbench.tsx');
  const start = source.indexOf('      const directProject =');
  const end = source.indexOf('      if (desktopApi.platform !== "browser")', start);
  const context = { cancelled: false, cloudEnabled, location: { search }, requestedRoute: new URLSearchParams(search).get('route'), settingsStore: { locale: 'en-US' }, getLocale: () => 'en-US', document: { documentElement: {} }, navigateToRoute: () => {}, setNavigationStatus: () => {}, loadGlobalSkills: async () => {}, loadGlobalRecipes: async () => {}, refreshCloudAccountSettings: async () => {}, showErrorMessage: () => {}, ...dependencies };
  const run = new (Object.getPrototypeOf(async function () {}).constructor)(...Object.keys(context), source.slice(start, end));
  return run(...Object.values(context));
}

test('embedded canvas waits only for preferences and project data before becoming ready', async () => {
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const names = ['loadAppSettings', 'loadGlobalSkills', 'loadGlobalRecipes', 'loadRecentProjects', 'initializeResourceLibraries', 'loadBoundWindowProject'];
  const pending = startup(Object.fromEntries(names.map(name => [name, async () => { calls.push(name); await gate; return true; }])));
  await new Promise(resolve => setImmediate(resolve));
  const parallel = [...calls];
  release();
  await pending;
  assert.deepEqual(parallel, ['loadAppSettings', 'loadBoundWindowProject']);
  assert.equal(calls.filter(name => name === 'loadBoundWindowProject').length, 1);
  assert.ok(!calls.includes('loadRecentProjects'), 'opening the project already refreshes the project library');
  assert.ok(!calls.includes('initializeResourceLibraries'), 'project reconciliation already awaits a fresh asset catalog');
});

test('embedded startup reads project and assets while settings load, then applies the project after settings', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud', storage: new Map(), withWindow: true });
  let releaseSettings, projectStarted, catalogStarted;
  const settingsGate = new Promise(resolve => { releaseSettings = resolve; });
  const projectRead = new Promise(resolve => { projectStarted = resolve; });
  const catalogRead = new Promise(resolve => { catalogStarted = resolve; });
  let pending;
  try {
    window.location = { search: '?native=embedded&project=fixture' };
    const { desktopApi } = await env.load('services/desktopApi');
    const { loadBoundWindowProject, store } = await env.load('store/projectStore');
    const initialProject = store.project.id;
    let appliedSettings = false, recentWrites = 0;
    desktopApi.project.getWindowProjectDir = async () => 'cloud/projects/fixture';
    desktopApi.project.readFile = async () => { projectStarted(); return { id:'fixture', schema:'shotloom-project', schemaVersion:2, nodes:[], edges:[], assets:[], materials:[], tasks:[] }; };
    desktopApi.localAssets.getCatalog = async () => { catalogStarted(); return { assets:[], materials:[], references:[] }; };
    desktopApi.recent.add = async () => { assert.equal(appliedSettings, true); recentWrites++; return []; };
    desktopApi.recent.list = async () => [];
    desktopApi.project.listRoot = async () => [];
    pending = startup({ loadBoundWindowProject, loadAppSettings: async () => { await settingsGate; appliedSettings = true; } });
    await Promise.race([Promise.all([projectRead, catalogRead]), new Promise((_, reject) => setTimeout(() => reject(new Error('Reads blocked on settings')), 1000))]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(store.project.id, initialProject, 'prefetched project cannot apply before settings');
    assert.equal(recentWrites, 0);
    releaseSettings();
    await pending;
    assert.equal(store.project.id, 'fixture');
    assert.equal(recentWrites, 1);
  } finally { releaseSettings(); await pending?.catch(() => {}); await env.dispose(); }
});

test('cancelled project startup discards prefetched data and missing-project recovery', async () => {
  for (const outcome of ['success', 'failure', 'unbound']) {
    const env = await createRendererEnv({ storageMode: 'cloud', storage: new Map(), withWindow: true });
    try {
      window.location = { search: '?native=embedded&project=fixture' };
      const { desktopApi } = await env.load('services/desktopApi');
      const { loadBoundWindowProject, store } = await env.load('store/projectStore');
      const initialProject = store.project.id;
      desktopApi.project.getWindowProjectDir = async () => outcome === 'unbound' ? null : 'cloud/projects/fixture';
      desktopApi.project.readFile = async () => { if (outcome === 'failure') throw new Error('Offline'); return { id:'fixture', nodes:[], edges:[] }; };
      desktopApi.localAssets.getCatalog = async () => ({ assets:[], materials:[], references:[] });
      desktopApi.file.pathExists = async () => { assert.fail('cancelled startup cannot perform recovery'); };
      desktopApi.recent.add = async () => { assert.fail('cancelled startup cannot write recent projects'); };
      assert.equal(await loadBoundWindowProject(async () => false), false);
      assert.equal(store.project.id, initialProject);
    } finally { await env.dispose(); }
  }
});

test('failed settings do not leave an unhandled early project failure or apply data', async () => {
  const failure = new Error('Settings unavailable');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const pending = startup({
    loadAppSettings: async () => { await gate; throw failure; },
    loadBoundWindowProject: async () => { throw new Error('Project unavailable'); },
  });
  const rejected = assert.rejects(pending, error => error === failure);
  await new Promise(resolve => setImmediate(resolve));
  release();
  await rejected;
});

test('embedded startup rejects project application after cancellation or a locale change', async () => {
  for (const mode of ['cancelled', 'locale']) {
    let project, reloads = 0;
    await startup({
      cancelled: mode === 'cancelled',
      settingsStore: { locale: mode === 'locale' ? 'zh-CN' : 'en-US' },
      window: { localStorage: { setItem: () => {} }, location: { reload: () => { reloads++; } } },
      LOCALE_STORAGE_KEY: 'locale',
      loadAppSettings: async () => {},
      loadBoundWindowProject: beforeApply => project = beforeApply().then(allowed => { assert.equal(allowed, false); return false; }),
      loadRecentProjects: async () => { assert.fail('discarded startup cannot load the library'); },
    });
    await project;
    assert.equal(reloads, mode === 'locale' ? 1 : 0);
  }
});

test('embedded canvas opens while recent-project bookkeeping is pending', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud', storage: new Map(), withWindow: true });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    window.location = { search: '?native=embedded&project=fixture' };
    const { desktopApi } = await env.load('services/desktopApi');
    const { loadBoundWindowProject } = await env.load('store/projectStore');
    desktopApi.project.getWindowProjectDir = async () => 'cloud/projects/fixture';
    desktopApi.project.readFile = async () => ({ schema: 'shotloom-project', schemaVersion: 2, id: 'fixture', nodes: [], edges: [], tasks: [], materials: [], assets: [] });
    desktopApi.localAssets.getCatalog = async () => ({ assets: [], materials: [], references: [] });
    desktopApi.recent.add = async () => { await gate; throw new Error('Recent list unavailable'); };
    assert.equal(await Promise.race([loadBoundWindowProject(), new Promise((_, reject) => setTimeout(() => reject(new Error('Canvas blocked on recent list')), 1000))]), true);
    release();
    await new Promise(resolve => setImmediate(resolve));
  } finally { release(); await env.dispose(); }
});

test('missing embedded project still refreshes the library', async () => {
  const calls = [];
  const names = ['loadAppSettings', 'loadGlobalSkills', 'loadGlobalRecipes', 'loadRecentProjects', 'initializeResourceLibraries', 'loadBoundWindowProject'];
  await startup(Object.fromEntries(names.map(name => [name, async () => { calls.push(name); return false; }])));
  assert.ok(calls.indexOf('loadRecentProjects') > calls.indexOf('loadBoundWindowProject'));
});

test('desktop startup retains library initialization after settings and before opening a project', async () => {
  for (const cloud of [false]) {
    const calls = [];
    const names = ['loadAppSettings', 'loadGlobalSkills', 'loadGlobalRecipes', 'loadRecentProjects', 'initializeResourceLibraries', 'loadBoundWindowProject'];
    await startup(Object.fromEntries(names.map(name => [name, async () => { calls.push(name); }])), '?route=projects', cloud);
    assert.equal(calls[0], 'loadAppSettings');
    assert.equal(calls.at(-1), 'loadBoundWindowProject');
    assert.equal(calls.length, names.length);
  }
});

test('web canvas becomes ready while unrelated catalogs and account remain pending', async () => {
  const pending = new Promise(() => {});
  const calls = [];
  await startup({
    loadAppSettings: async options => { assert.equal(options.preferencesOnly, true); calls.push('preferences'); },
    loadBoundWindowProject: async beforeApply => { calls.push('project'); assert.equal(await beforeApply(), true); return true; },
    loadGlobalSkills: () => { calls.push('skills'); return pending; },
    loadGlobalRecipes: () => { calls.push('recipes'); return pending; },
    refreshCloudAccountSettings: () => { calls.push('account'); return pending; },
    setNavigationStatus: status => calls.push(status),
  }, '?route=creation&project=fixture');
  assert.deepEqual(calls, ['preferences', 'project', 'ready', 'skills', 'recipes', 'account']);
});

test('web library reads overlap settings, but project application and page readiness wait for both', async () => {
  let releaseSettings, releaseLibraries;
  const settings = new Promise(resolve => { releaseSettings = resolve; });
  const libraries = new Promise(resolve => { releaseLibraries = resolve; });
  const calls = [];
  const running = startup({
    loadAppSettings: async options => { assert.equal(options.preferencesOnly, true); calls.push('preferences'); await settings; },
    loadGlobalSkills: async () => { calls.push('skills'); await libraries; },
    loadGlobalRecipes: async () => { calls.push('recipes'); await libraries; },
    loadRecentProjects: async () => { calls.push('recent'); await libraries; },
    initializeResourceLibraries: async () => { calls.push('assets'); await libraries; },
    loadBoundWindowProject: async beforeApply => { calls.push('read-project'); assert.equal(await beforeApply(), true); calls.push('apply-project'); return true; },
    refreshCloudAccountSettings: async () => { calls.push('account'); },
    setNavigationStatus: status => calls.push(status),
  }, '?route=skills&project=fixture');
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ['preferences', 'skills', 'recipes', 'recent', 'assets', 'read-project']);
    releaseSettings(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.includes('ready'), false);
    releaseLibraries(); await running;
    assert(calls.indexOf('apply-project') > calls.indexOf('read-project'));
    assert.deepEqual(calls.slice(-3), ['apply-project', 'ready', 'account']);
  } finally { releaseSettings(); releaseLibraries(); await running; }
});

test('bound project opening waits for the asset catalog before reconciling references', async () => {
  const env = await createRendererEnv({ storage: new Map(), withWindow: true });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let opening;
  try {
    const { desktopApi } = await env.load('services/desktopApi');
    const { loadBoundWindowProject, store } = await env.load('store/projectStore');
    const { localAssetLibrary } = await env.load('store/localAssetLibraryStore');
    const project = { id: 'project', schema: 'shotloom-project', schemaVersion: 2, name: 'Project', nodes: [], edges: [], materials: [{ id: 'material', storageScope: 'library', localLibraryMaterialId: 'library-material' }], assets: [], tasks: [] };
    const catalog = { assets: [{ id: 'asset', materialId: 'library-material' }], materials: [], references: [{ id: 'reference', projectKey: 'project', projectName: 'Project', materialId: 'material', libraryMaterialId: 'library-material', assetId: 'asset' }] };
    let catalogReads = 0, finished = false;
    desktopApi.project.getWindowProjectDir = async () => 'browser/projects/project';
    desktopApi.project.readFile = async () => structuredClone(project);
    desktopApi.localAssets.getCatalog = async () => { catalogReads++; await gate; return structuredClone(catalog); };
    desktopApi.localAssets.setCatalog = async value => value;
    opening = loadBoundWindowProject().then(value => { finished = true; return value; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, false, 'canvas must not become ready with an unloaded catalog');
    release();
    assert.equal(await opening, true);
    assert.equal(catalogReads, 1);
    assert.equal(store.project.id, project.id);
    assert.equal(localAssetLibrary.catalog.references[0].id, 'reference');
  } finally { release(); await opening; await env.dispose(); }
});

test('embedded startup overlaps project and asset reads, shares pending loads and reconciles only after both finish', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud', storage: new Map(), withWindow: true });
  let releaseProject, releaseCatalog;
  const projectGate = new Promise(resolve => { releaseProject = resolve; });
  const catalogGate = new Promise(resolve => { releaseCatalog = resolve; });
  let opening;
  try {
    window.location = { search: '?native=embedded&project=fixture' };
    const { desktopApi } = await env.load('services/desktopApi');
    const { loadBoundWindowProject } = await env.load('store/projectStore');
    const { loadLocalAssetLibrary, localAssetLibrary } = await env.load('store/localAssetLibraryStore');
    let projectReads = 0, catalogReads = 0, done = false;
    desktopApi.project.getWindowProjectDir = async () => 'cloud/projects/fixture';
    desktopApi.project.readFile = async () => { projectReads++; await projectGate; return { id:'fixture', schema:'shotloom-project', schemaVersion:2, nodes:[], edges:[], assets:[], materials:[], tasks:[] }; };
    desktopApi.localAssets.getCatalog = async () => { catalogReads++; await catalogGate; return { assets:[], materials:[], references:[] }; };
    desktopApi.recent.add = async () => [];
    desktopApi.recent.list = async () => [];
    desktopApi.project.listRoot = async () => [];
    opening = loadBoundWindowProject().then(value => { done = true; return value; });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(projectReads, 1);
    assert.equal(catalogReads, 1, 'asset read starts while project read is still pending');
    const concurrent = loadLocalAssetLibrary(true);
    assert.equal(catalogReads, 1);
    let catalogDone = false; void concurrent.then(() => { catalogDone = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(catalogDone, false, 'concurrent callers cannot receive a stale catalog');
    releaseCatalog(); await concurrent;
    assert.equal(localAssetLibrary.loaded, true);
    assert.equal(done, false, 'catalog alone cannot open the project');
    releaseProject(); assert.equal(await opening, true);
    assert.equal(catalogReads, 1, 'reconciliation reuses the prefetched catalog even when it finished first');
  } finally { releaseCatalog(); releaseProject(); await opening?.catch(() => {}); await env.dispose(); }
});
