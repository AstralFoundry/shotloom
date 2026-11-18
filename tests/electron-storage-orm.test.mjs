import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const bundled = await build({
  stdin: { contents: `export * from './electron/core/db'; export * from './electron/core/storage'; export * from './electron/core/projectStorage'; export { orm } from './electron/core/sqliteOrm'; export * as models from './electron/core/schema'; export { getTableConfig } from 'drizzle-orm/sqlite-core';`, resolveDir: process.cwd() },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const bundleRoot = mkdtempSync(join(tmpdir(), 'shotloom-orm-module-'));
const bundleFile = join(bundleRoot, 'storage.mjs');
writeFileSync(bundleFile, bundled.outputFiles[0].text);
const api = await import(pathToFileURL(bundleFile));
test.after(() => rmSync(bundleRoot, { recursive: true, force: true }));
const hostile = `中文 ' "; DROP TABLE settings; -- /?#`;
function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'shotloom-orm-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return join(root, 'project.sqlite');
}
function project() {
  return { id: 'project', name: hostile, createdAt: '1', updatedAt: '2',
    nodes: [{ id: 'n1', type: 'text', title: hostile }, { id: 'n2', type: 'text' }],
    edges: [{ id: 'e1', source: 'n1', target: 'n2' }], tasks: [{ id: 't1', nodeId: 'n1', status: 'running' }],
    assets: [{ id: 'a1', materialId: 'm1' }], materials: [{ id: 'm1', filePath: hostile }],
    harnessSessions: [{ id: 's1', agentId: 'agent' }], productionPlans: [{ id: 'p1', name: hostile }],
    agentBatches: [{ id: 'b1', name: hostile }], agentEvaluations: [{ id: 'r1', name: hostile }], canvasHistory: [{ title: hostile }], canvasRedoStack: [] };
}

test('ORM round-trips settings, catalogs and native records without interpreting SQL characters', t => {
  const path = workspace(t);
  api.withDatabase(path, db => api.transaction(db, () => {
    api.setDownloadDirectory(db, hostile);
    api.saveSettings(db, { theme: hostile, downloadDirectory: 'must not overwrite' });
    assert.deepEqual(api.loadSettings(db, {}), { theme: hostile, downloadDirectory: hostile });
    api.setSettingsField(db, 'theme', 'dark');
    assert.equal(api.settingsField(db, 'theme'), 'dark');
    const catalog = { version: 1, skills: [{ id: hostile, name: hostile, enabled: false }] };
    api.saveCatalog(db, 'skills', catalog);
    assert.deepEqual(api.loadCatalog(db, 'skills'), catalog);
    const assets = { assets: [{ id: 'a', materialId: 'm' }], materials: [{ id: 'm', filePath: hostile }] };
    api.saveCatalog(db, 'assets', assets);
    assert.deepEqual(api.loadCatalog(db, 'assets'), assets);
    api.saveRecovery(db, hostile, { error: hostile });
    api.saveRecovery(db, hostile, { updated: true });
    assert.deepEqual(api.loadRecovery(db, hostile), { updated: true });
    api.saveClipboard(db, hostile, { text: hostile });
    assert.deepEqual(api.loadClipboard(db, hostile), { text: hostile });
    api.bindWindowProject(db, hostile, hostile);
    assert.equal(api.windowProject(db, hostile), hostile);
    api.bindWindowProject(db, hostile, null);
    assert.equal(api.windowProject(db, hostile), null);
    api.addRecent(db, { filePath: hostile, name: 'first' });
    api.addRecent(db, { filePath: hostile, name: 'updated' });
    assert.deepEqual(api.recentList(db), [{ filePath: hostile, name: 'updated' }]);
    api.removeRecent(db, hostile);
    assert.deepEqual(api.recentList(db), []);
  }));
});

test('project writes preserve relations and roll back on foreign key or revision failure', t => {
  const path = workspace(t);
  const value = project();
  const saved = api.withDatabase(path, db => api.transaction(db, () => api.saveProject(db, value)));
  assert.deepEqual(api.loadProjectFile(path), saved);
  assert.throws(() => api.withDatabase(path, db => api.transaction(db, () => api.saveProject(db, { ...saved, name: 'bad', edges: [{ id: 'bad', source: 'missing', target: 'n2' }] }))), /FOREIGN KEY/);
  assert.deepEqual(api.loadProjectFile(path), saved);
  assert.throws(() => api.withDatabase(path, db => api.transaction(db, () => api.saveProject(db, { ...saved, storageRevision: 0 }))), /shotloom:localized-error/);
  assert.deepEqual(api.loadProjectFile(path), saved);
});

test('ORM nested transactions isolate inner rollback and roll back outer failures', t => {
  const path = workspace(t);
  api.withDatabase(path, db => {
    api.transaction(db, () => {
      api.setSettingsField(db, 'outer', 'keep');
      assert.throws(() => api.transaction(db, () => { api.setSettingsField(db, 'inner', 'discard'); throw new Error('inner failed'); }), /inner failed/);
      assert.equal(api.settingsField(db, 'inner'), undefined);
    });
    assert.equal(api.settingsField(db, 'outer'), 'keep');
    assert.throws(() => api.transaction(db, () => { api.setSettingsField(db, 'outer', 'discard'); throw new Error('outer failed'); }), /outer failed/);
    assert.equal(api.settingsField(db, 'outer'), 'keep');
  });
});

test('snapshot retention, nullable payloads and composite editor records survive reopen', t => {
  const path = workspace(t);
  for (let index = 0; index < 23; index++) api.createProjectSnapshot(path, {
    id: String(index), createdAt: String(index).padStart(3, '0'), mediaRefs: [hostile], payload: { index },
  });
  const snapshots = api.listProjectSnapshots(path);
  assert.equal(snapshots.length, 20);
  assert.equal(snapshots[0].id, '22');
  assert.deepEqual(snapshots[0].mediaRefs, [hostile]);
  assert.equal(api.readProjectSnapshot(path, '0'), null);
  assert.deepEqual(api.readProjectSnapshot(path, '22'), { index: 22 });
  api.saveEditorSnapshot(path, hostile, { revision: 1 });
  api.saveEditorSnapshot(path, hostile, { revision: 2 });
  assert.deepEqual(api.editorSnapshot(path, hostile), { revision: 2 });
  api.setEditorRecord(path, hostile, hostile, { data: hostile });
  api.setEditorRecord(path, hostile, 'other', { keep: true });
  api.setEditorRecord(path, hostile, hostile, { updated: true });
  assert.deepEqual(api.editorRecord(path, hostile, hostile), { updated: true });
  api.setEditorRecord(path, hostile, hostile, null);
  assert.equal(api.editorRecord(path, hostile, hostile), null);
  assert.deepEqual(api.editorRecord(path, hostile, 'other'), { keep: true });
});

test('existing v2 databases upgrade and backup paths are bound as data', t => {
  const path = workspace(t);
  api.withDatabase(path, db => {
    api.setMetadataValue(db, 'database-version', 2);
    api.setSettingsField(db, 'keep', hostile);
    db.exec('ALTER TABLE project_snapshots DROP COLUMN media_refs');
  });
  api.withDatabase(path, db => {
    assert.equal(api.metadataValue(db, 'database-version'), 3);
    assert.equal(api.settingsField(db, 'keep'), hostile);
  });
  const destination = join(path, '..', "backup 'quoted.sqlite");
  api.backupDatabase(path, destination);
  api.withDatabase(destination, db => assert.equal(api.settingsField(db, 'keep'), hostile));
});

test('v1 collection migration retains payloads and rebuilds relation columns', t => {
  const path = workspace(t);
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE catalog_metadata (scope varchar PRIMARY KEY, payload json NOT NULL);
    CREATE TABLE nodes (id varchar PRIMARY KEY, position integer, payload json);
    CREATE TABLE edges (id varchar PRIMARY KEY, position integer, payload json);
    CREATE TABLE tasks (id varchar PRIMARY KEY, position integer, payload json);
    CREATE TABLE assets (id varchar PRIMARY KEY, position integer, payload json);
    CREATE TABLE materials (id varchar PRIMARY KEY, position integer, payload json);
    CREATE TABLE conversations (id varchar PRIMARY KEY, position integer, payload json);
    CREATE TABLE skills (id varchar PRIMARY KEY, position integer, payload json);
    CREATE TABLE recipes (id varchar PRIMARY KEY, position integer, payload json);`);
  db.prepare('INSERT INTO catalog_metadata VALUES (?, ?)').run('database-version', '1');
  db.prepare('INSERT INTO nodes VALUES (?, ?, ?)').run('n1', 0, JSON.stringify({ id: 'n1', type: 'text', title: hostile }));
  db.prepare('INSERT INTO nodes VALUES (?, ?, ?)').run('n2', 1, JSON.stringify({ id: 'n2', type: 'text' }));
  db.prepare('INSERT INTO edges VALUES (?, ?, ?)').run('e1', 0, JSON.stringify({ id: 'e1', source: 'n1', target: 'n2' }));
  db.close();
  api.withDatabase(path, upgraded => {
    assert.equal(api.metadataValue(upgraded, 'database-version'), 3);
    const rows = api.orm(upgraded).select().from(api.models.nodes).all();
    assert.equal(rows[0].title, hostile);
    assert.equal(api.orm(upgraded).select().from(api.models.edges).get().source, 'n1');
  });
});


test('unsupported versions are rejected without rewriting the original database', t => {
  const path = workspace(t);
  api.withDatabase(path, db => {
    api.setMetadataValue(db, 'database-version', 999);
    api.setSettingsField(db, 'keep', hostile);
  });
  assert.throws(() => api.openDatabase(path), /shotloom:localized-error/);
  const native = new DatabaseSync(path);
  try {
    assert.equal(JSON.parse(String(native.prepare('SELECT payload FROM catalog_metadata WHERE scope = ?').get('database-version').payload)), 999);
    assert.equal(JSON.parse(native.prepare('SELECT payload FROM settings WHERE key = ?').get('keep').payload), hostile);
  } finally { native.close(); }
});


test('editor media scan includes snapshots and separately stored undo records', t => {
  const path = workspace(t);
  api.saveEditorSnapshot(path, 'editor-1', { assets: [{ sourceFile: '/project/assets/hero.png' }] });
  api.setEditorRecord(path, 'editor-1', 'undo', { sourceFile: '/project/assets/old.png' });
  const media = api.editorMediaState(path);
  assert.equal(media.length, 2);
  assert.ok(JSON.stringify(media).includes('/project/assets/hero.png'));
  assert.ok(JSON.stringify(media).includes('/project/assets/old.png'));
});

test('ORM model columns match the persisted migration schema', t => {
  const path = workspace(t);
  api.withDatabase(path, db => {
    for (const [name, table] of Object.entries(api.models)) {
      if (name === 'collectionTables') continue;
      const config = api.getTableConfig(table);
      const columns = db.prepare('SELECT name, type, "notnull" FROM pragma_table_info(?)').all(config.name);
      assert.deepEqual(columns.map(column => column.name), config.columns.map(column => column.name), config.name);
      assert.deepEqual(columns.map(column => Boolean(column.notnull)), config.columns.map(column => column.notNull), config.name);
    }
  });
});
