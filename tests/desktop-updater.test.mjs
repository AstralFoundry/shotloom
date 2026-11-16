import assert from 'node:assert/strict';
import test from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';
import { installDesktopBridge } from './helpers/desktopBridge.mjs';

/**
 * 渲染进程的更新桥：检查结果映射成 Update 对象，下载进度按 Started/Progress/Finished
 * 事件回放给调用方，关闭时取消本地下载。原生侧（electron-updater）无法在离线测试里跑，
 * 这里验证契约本身。
 */
test('desktop updater maps check/download/close to the native update channel', async () => {
  const env = await createRendererEnv({ withWindow: true });
  try {
    const invoked = [];
    const bridge = installDesktopBridge({
      update: {
        check: async () => ({ version: '9.2.0', body: 'Release notes' }),
        download: async (id) => {
          invoked.push(['download', id]);
          bridge.emit('update-progress', { id, event: 'Progress', data: { chunkLength: 512, contentLength: 2048 } });
          return { ok: true };
        },
        cancel: async (id) => { invoked.push(['cancel', id]); return { ok: true }; },
        install: async (id) => { invoked.push(['install', id]); return { ok: true }; },
        relaunch: async () => {},
        onProgress: (handler) => {
          const dispose = bridge.bridge.listen('update-progress', handler);
          return dispose;
        },
      },
    });
    const { check } = await env.load('desktop/updater');
    const update = await check();
    assert.equal(update.version, '9.2.0');
    assert.equal(update.body, 'Release notes');
    const events = [];
    await update.download((event) => events.push(event));
    assert.deepEqual(invoked, [['download', '9.2.0']]);
    assert.deepEqual(events, [{ event: 'Progress', data: { chunkLength: 512, contentLength: 2048 } }]);
    await update.install();
    assert.deepEqual(invoked.at(-1), ['install', '9.2.0']);
    await update.close();
    assert.deepEqual(invoked.at(-1), ['cancel', '9.2.0']);
  } finally {
    await env.dispose();
  }
});

test('desktop updater reports no update and surfaces download failures', async () => {
  const env = await createRendererEnv({ withWindow: true });
  try {
    installDesktopBridge({
      update: {
        check: async () => null,
        download: async () => ({ ok: false, error: 'Connection reset' }),
        cancel: async () => ({ ok: true }),
        install: async () => ({ ok: false }),
        relaunch: async () => {},
        onProgress: () => () => {},
      },
    });
    const { check } = await env.load('desktop/updater');
    assert.equal(await check(), null);
  } finally {
    await env.dispose();
  }
  const second = await createRendererEnv({ withWindow: true });
  try {
    installDesktopBridge({
      update: {
        check: async () => ({ version: '9.2.1', body: '' }),
        download: async () => ({ ok: false, error: 'Connection reset' }),
        cancel: async () => ({ ok: true }),
        install: async () => ({ ok: false }),
        relaunch: async () => {},
        onProgress: () => () => {},
      },
    });
    const { check } = await second.load('desktop/updater');
    const update = await check();
    await assert.rejects(update.download(), /Connection reset/);
  } finally {
    await second.dispose();
  }
});
