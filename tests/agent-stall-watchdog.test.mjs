/**
 * 行为测试：真实推进时钟，验证用户在运行卡住时实际会看到几次提示、什么时候恢复。
 *
 * 卡住提示是运行时的客观事实（事件出口还有没有动静），不是语义判断，
 * 所以这里断言提示次数、间隔与分类，而不是检查源码文本。
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const TICK_MS = 10_000;

let server;
let createStallWatchdog;

before(async () => {
  const rendererRoot = fileURLToPath(new URL('../renderer', import.meta.url));
  server = await createServer({
    configFile: false,
    root: rendererRoot,
    resolve: { alias: { '@': path.join(rendererRoot, 'src') } },
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  ({ createStallWatchdog } = await server.ssrLoadModule('/src/agent/loop/stallWatchdog.ts'));
});

after(async () => {
  await server?.close();
});

/**
 * mock 时钟在一次 tick 内只把 Date.now 移到终点，整段 tick 会被压成同一个静默时长。
 * 必须按看门狗自己的巡检粒度逐格推进，否则提示次数与静默时长的断言都失真。
 */
function advance(t, ms) {
  for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) t.mock.timers.tick(TICK_MS);
}

/**
 * 用一条有序日志记录提示与恢复：两者的先后关系本身就是被测行为，
 * 拆成两个计数器会把“恢复只报一次”这类断言变弱。
 */
function run(t) {
  const log = [];
  const watchdog = createStallWatchdog({
    stalled: (silent) => log.push({ kind: 'stalled', ...silent }),
    recovered: () => log.push({ kind: 'recovered' }),
  });
  t.after(() => watchdog.stop());
  return {
    watchdog,
    log,
    notices: () => log.filter((entry) => entry.kind === 'stalled'),
  };
}

test('静默到告警阈值只提示一次，冷却期内持续静默不重复提示', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  const harness = run(t);
  harness.watchdog.start();

  advance(t, 170_000);
  assert.deepEqual(harness.log, [], '未到 180 秒不应打扰用户');

  advance(t, 10_000);
  assert.deepEqual(harness.notices(), [{ kind: 'stalled', silentMs: 180_000, watchdog: 'no_progress' }]);

  advance(t, 100_000);
  assert.equal(harness.notices().length, 1, '冷却期内的静默不该连着弹提示');
});

test('冷却期满后同一轮静默再次提示，让用户知道仍在等待', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  const harness = run(t);
  harness.watchdog.start();

  advance(t, 300_000);
  assert.deepEqual(harness.notices().map((item) => [item.silentMs, item.watchdog]), [
    [180_000, 'no_progress'],
    [300_000, 'no_progress'],
  ]);
});

test('运行超过半小时后提示改为长时运行语义', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  const harness = run(t);
  harness.watchdog.start();

  advance(t, 1_790_000);
  assert.ok(harness.notices().every((item) => item.watchdog === 'no_progress'), '未到硬上限不该用长时运行文案');

  advance(t, 310_000);
  const notices = harness.notices();
  const last = notices[notices.length - 1];
  assert.equal(last.watchdog, 'hard_cap');
  assert.ok(last.silentMs >= 1_800_000, '长时运行提示必须在超过硬上限后才出现');
});

test('任何事件都算活着：恢复只报一次，静默计时重新开始', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  const harness = run(t);
  harness.watchdog.start();

  advance(t, 180_000);
  assert.equal(harness.notices().length, 1);

  harness.watchdog.activity();
  harness.watchdog.activity();
  assert.deepEqual(harness.log.slice(1), [{ kind: 'recovered' }], '恢复只能有一次');

  // 恢复后重新计时，下一次静默仍是普通卡住语义，不会继承长时运行分类。
  harness.log.length = 0;
  advance(t, 180_000);
  assert.deepEqual(harness.notices(), [{ kind: 'stalled', silentMs: 180_000, watchdog: 'no_progress' }]);
});

test('持续有事件时不提示，停止后不再产生提示', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  const harness = run(t);
  harness.watchdog.start();

  for (let index = 0; index < 6; index += 1) {
    advance(t, 60_000);
    harness.watchdog.activity();
  }
  assert.deepEqual(harness.log, [], '每 60 秒有动静就不该判定为卡住');

  harness.watchdog.stop();
  advance(t, 600_000);
  assert.deepEqual(harness.log, [], '运行结束后不能再有提示');
});
