import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const epoch = 1_700_000_000_000;
const mib = 1024 * 1024;

// Bundle the real public API, replacing only OS/Electron/storage boundaries.
// Each VM owns its process, clock and journal; no GUI, files or global mocks.
async function recoveryFixture(t, { platform = 'win32', bytes = 1_610_612_736 } = {}) {
  const records = new Map();
  const events = [];
  const commands = [];
  const reads = [];
  const timers = new Map();
  const database = {};
  const webContents = {};
  let now = epoch;
  let sample = bytes;
  let samples = 0;
  let vmStat = 'Mach Virtual Memory Statistics: (page size of 4096 bytes)\n'
    + 'Pages free: 100.\nPages inactive: 200.\nPages speculative: 3.\n';
  let meminfo = 'MemTotal:       8388608 kB\nMemFree: 99 kB\nMemAvailable: 1234567 kB\n';
  const fixture = {
    app: { getVersion: () => '0.9.2-test' },
    BrowserWindow: { getAllWindows: () => [{ webContents }] },
    withDatabase(path, work) {
      assert.equal(path, 'memory/app.sqlite');
      return work(database);
    },
    appDataFile(name) {
      assert.equal(name, 'app.sqlite');
      return 'memory/' + name;
    },
    loadRecovery(db, kind) {
      assert.equal(db, database);
      return records.has(kind) ? structuredClone(records.get(kind)) : null;
    },
    saveRecovery(db, kind, journal) {
      assert.equal(db, database);
      records.set(kind, structuredClone(journal));
    },
    emitEvent(target, name, payload) {
      assert.equal(target, webContents);
      events.push({ name, payload: structuredClone(payload) });
    },
    freemem() {
      samples++;
      if (sample instanceof Error) throw sample;
      return sample;
    },
    execFileSync(command, options) {
      commands.push(command);
      assert.equal(platform, 'darwin', 'memory polling must not start a Windows/Linux child');
      assert.equal(command, 'vm_stat');
      assert.equal(options.encoding, 'utf8');
      return vmStat;
    },
    unexpectedChild(...args) {
      commands.push(args);
      throw new Error('Unexpected child_process call');
    },
    readFileSync(path, encoding) {
      reads.push(path);
      assert.equal(platform, 'linux');
      assert.equal(path, '/proc/meminfo');
      assert.equal(encoding, 'utf8');
      return meminfo;
    },
  };
  const replacements = {
    electron: 'export const { app, BrowserWindow } = __fixture;',
    './db': 'export const { withDatabase } = __fixture;',
    './paths': 'export const { appDataFile } = __fixture;',
    './storage': 'export const { loadRecovery, saveRecovery } = __fixture;',
    '../ipc/registry': 'export const { emitEvent } = __fixture;',
    'node:os': 'export const { freemem } = __fixture;',
    'node:fs': 'export const { readFileSync } = __fixture;',
    'node:child_process': `
      export const { execFileSync } = __fixture;
      export const spawn = __fixture.unexpectedChild;
      export const spawnSync = __fixture.unexpectedChild;
      export const exec = __fixture.unexpectedChild;
      export const execSync = __fixture.unexpectedChild;
      export const execFile = __fixture.unexpectedChild;
      export const fork = __fixture.unexpectedChild;
    `,
  };
  const bundled = await build({
    stdin: { contents: "export * from './electron/core/recovery';", resolveDir: repoRoot },
    bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
    plugins: [{
      name: 'recovery-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, args =>
          Object.hasOwn(replacements, args.path) ? { path: args.path, namespace: 'recovery-test' } : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'recovery-test' }, args =>
          ({ contents: replacements[args.path] }));
      },
    }],
  });
  const module = { exports: {} };
  runInNewContext(bundled.outputFiles[0].text, {
    module, exports: module.exports, __fixture: fixture, console,
    process: { platform, pid: 12345, memoryUsage: () => ({ rss: 8_388_608 }) },
    Date: { now: () => now },
    setInterval(callback, delay) {
      assert.ok(delay > 0);
      const timer = { callback, delay, next: now + delay, unref() {} };
      timers.set(timer, timer);
      return timer;
    },
    clearInterval(timer) { timers.delete(timer); },
    require(name) { throw new Error('Unstubbed import: ' + name); },
  }, { filename: 'electron-recovery.test.bundle.cjs' });
  const api = module.exports;
  t.after(() => api.stopRecovery());
  return {
    api, events, commands, reads, records,
    current: () => structuredClone(api.recoveryStatus().current),
    setBytes(value) { sample = value; },
    setVmStat(value) { vmStat = value; },
    setMeminfo(value) { meminfo = value; },
    samples: () => samples,
    timers: () => timers.size,
    advance(ms) {
      assert.ok(ms >= 0);
      const end = now + ms;
      for (;;) {
        const next = [...timers.values()].sort((a, b) => a.next - b.next)[0];
        if (!next || next.next > end) break;
        now = next.next;
        next.next += next.delay;
        next.callback();
      }
      now = end;
    },
  };
}

test('Windows initialization persists available physical memory in KiB (null regression)', async t => {
  const f = await recoveryFixture(t);
  f.api.initializeRecovery();
  assert.equal(f.current().availableMemoryKb, 1_572_864);
  assert.equal(f.records.get('runtime').availableMemoryKb, 1_572_864);
  assert.equal(f.records.get('runtime').rssKb, 8192);
  assert.equal(f.records.get('runtime').heartbeatAt, String(epoch));
  assert.equal(f.samples(), 1);
});

test('Windows heartbeat refreshes sampling and persistence only after 30 seconds', async t => {
  const f = await recoveryFixture(t);
  f.api.initializeRecovery();
  f.setBytes(2_147_483_648);
  f.advance(29_999);
  assert.equal(f.current().availableMemoryKb, 1_572_864);
  assert.equal(f.samples(), 1);
  f.advance(1);
  assert.equal(f.current().availableMemoryKb, 2_097_152);
  assert.equal(f.records.get('runtime').availableMemoryKb, 2_097_152);
  assert.equal(f.records.get('runtime').heartbeatAt, String(epoch + 30_000));
  assert.equal(f.samples(), 2);
});

test('Windows low memory needs three consecutive heartbeats before broadcasting', async t => {
  const f = await recoveryFixture(t, { bytes: 768 * mib });
  f.api.initializeRecovery();
  f.advance(60_000);
  assert.equal(f.events.length, 0);
  f.advance(30_000);
  assert.deepEqual(f.events, [{
    name: 'system-memory-pressure',
    payload: { level: 'low', availableMemoryKb: 786432, rssKb: 8192 },
  }]);
});

test('Windows critical memory broadcasts on the first heartbeat', async t => {
  const f = await recoveryFixture(t, { bytes: 256 * mib });
  f.api.initializeRecovery();
  assert.equal(f.events.length, 0);
  f.advance(30_000);
  assert.deepEqual(f.events, [{
    name: 'system-memory-pressure',
    payload: { level: 'critical', availableMemoryKb: 262144, rssKb: 8192 },
  }]);
});

for (const [name, bytes, wantKb, afterFirst, afterThird] of [
  ['exactly 1 GiB', 1_073_741_824, 1_048_576, null, null],
  ['one byte below 1 GiB', 1_073_741_823, 1_048_575, null, 'low'],
  ['exactly 512 MiB', 536_870_912, 524_288, null, 'low'],
  ['one byte below 512 MiB', 536_870_911, 524_287, 'critical', 'critical'],
  ['zero physical memory', 0, 0, 'critical', 'critical'],
]) {
  test('Windows memory boundary: ' + name, async t => {
    const f = await recoveryFixture(t, { bytes });
    f.api.initializeRecovery();
    assert.equal(f.current().availableMemoryKb, wantKb);
    f.advance(30_000);
    assert.equal(f.events[0]?.payload.level ?? null, afterFirst);
    f.advance(60_000);
    assert.equal(f.events[0]?.payload.level ?? null, afterThird);
    assert.equal(f.events.length, afterThird === null ? 0 : 1);
  });
}

for (const [name, bytes] of [
  ['NaN', NaN], ['Infinity', Infinity], ['negative', -1], ['exception', new Error('sampler failed')],
]) {
  test('Windows invalid memory remains unknown and heartbeat continues: ' + name, async t => {
    const f = await recoveryFixture(t, { bytes });
    f.api.initializeRecovery();
    assert.equal(f.records.get('runtime').availableMemoryKb, null);
    f.advance(90_000);
    assert.equal(f.records.get('runtime').availableMemoryKb, null);
    assert.equal(f.records.get('runtime').heartbeatAt, String(epoch + 90_000));
    assert.equal(f.samples(), 4);
    assert.equal(f.events.length, 0);
    f.setBytes(1_610_612_736);
    f.advance(30_000);
    assert.equal(f.current().availableMemoryKb, 1_572_864);
  });
}

for (const [name, resetSample] of [['normal', 2_147_483_648], ['unknown', NaN]]) {
  test('Windows ' + name + ' memory breaks the low-memory consecutive count', async t => {
    const f = await recoveryFixture(t, { bytes: 768 * mib });
    f.api.initializeRecovery();
    f.advance(60_000);
    f.setBytes(resetSample);
    f.advance(30_000);
    f.setBytes(768 * mib);
    f.advance(60_000);
    assert.equal(f.events.length, 0);
    f.advance(30_000);
    assert.equal(f.events.length, 1);
    assert.equal(f.events[0].payload.level, 'low');
  });
}

for (const [name, bytes, firstAt, cooldown] of [
  ['low', 768 * mib, 90_000, 600_000],
  ['critical', 256 * mib, 30_000, 120_000],
]) {
  test('Windows ' + name + ' notifications respect the existing cooldown', async t => {
    const f = await recoveryFixture(t, { bytes });
    f.api.initializeRecovery();
    f.advance(firstAt);
    assert.equal(f.events.length, 1);
    f.advance(cooldown - 1);
    assert.equal(f.events.length, 1);
    f.advance(1);
    assert.equal(f.events.length, 2);
    assert.equal(f.events[1].payload.level, name);
  });
}

test('markCleanExit persists a clean journal and stops sampling', async t => {
  const f = await recoveryFixture(t);
  f.api.initializeRecovery();
  f.advance(30_000);
  f.api.markCleanExit();
  const saved = structuredClone(f.records.get('runtime'));
  const samples = f.samples();
  assert.equal(saved.cleanExit, true);
  assert.equal(f.timers(), 0);
  f.advance(120_000);
  assert.equal(f.samples(), samples);
  assert.deepEqual(f.records.get('runtime'), saved);
  assert.equal(f.events.length, 0);
});

test('stopRecovery removes the timer without marking an unclean session clean', async t => {
  const f = await recoveryFixture(t);
  f.api.initializeRecovery();
  f.api.stopRecovery();
  const samples = f.samples();
  f.advance(120_000);
  assert.equal(f.timers(), 0);
  assert.equal(f.samples(), samples);
  assert.equal(f.current().cleanExit, false);
});

test('Windows recovery never calls child_process or reads a platform memory file', async t => {
  const f = await recoveryFixture(t);
  f.api.initializeRecovery();
  f.advance(120_000);
  assert.equal(f.samples(), 5);
  assert.deepEqual(f.commands, []);
  assert.deepEqual(f.reads, []);
});

test('macOS retains free + inactive + speculative vm_stat page accounting', async t => {
  const f = await recoveryFixture(t, { platform: 'darwin' });
  f.api.initializeRecovery();
  assert.equal(f.current().availableMemoryKb, 1212);
  f.setVmStat('Mach Virtual Memory Statistics: (page size of 16384 bytes)\n'
    + 'Pages free: 2.\nPages inactive: 3.\nPages speculative: 1.\n');
  f.advance(30_000);
  assert.equal(f.current().availableMemoryKb, 96);
  assert.deepEqual(f.commands, ['vm_stat', 'vm_stat']);
  assert.equal(f.samples(), 0);
});

test('Linux retains MemAvailable rather than MemFree sampling', async t => {
  const f = await recoveryFixture(t, { platform: 'linux' });
  f.api.initializeRecovery();
  assert.equal(f.current().availableMemoryKb, 1_234_567);
  f.setMeminfo('MemFree: 987654 kB\nMemAvailable: 2345678 kB\n');
  f.advance(30_000);
  assert.equal(f.current().availableMemoryKb, 2_345_678);
  assert.deepEqual(f.reads, ['/proc/meminfo', '/proc/meminfo']);
  assert.deepEqual(f.commands, []);
  assert.equal(f.samples(), 0);
});
