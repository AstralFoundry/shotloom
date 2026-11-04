import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('Shotloom pins the official Harness loop and chat entry points together', async () => {
  const manifest = JSON.parse(await readFile(new URL('harness/host/package.json', root), 'utf8'));
  assert.equal(manifest.dependencies['@deepseek-ai/dsh-agent-loop'], '0.2.1-alpha.2');
  assert.equal(manifest.dependencies['@deepseek-ai/dsh-client-ui-chat'], manifest.dependencies['@deepseek-ai/dsh-agent-loop']);
});

test('embedded chat uses the product locale without changing the containing document', async () => {
  const { build } = await import('esbuild');
  const { fileURLToPath } = await import('node:url');
  const result = await build({
    entryPoints: [fileURLToPath(new URL('harness/host/client/i18n.ts', root))],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2023',
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`;
  const descriptors = Object.fromEntries(['document', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const [index, input] of ['en-US', 'zh-CN', 'unknown', null].entries()) {
      const expected = input === 'en-US' ? 'en-US' : 'zh-CN';
      const rootElement = { lang: 'uninitialized' };
      Object.defineProperties(globalThis, {
        document: { configurable: true, value: { documentElement: rootElement } },
        localStorage: { configurable: true, value: { getItem: key => key === 'shotloom:locale' ? input : null } },
      });
      const client = await import(`${moduleUrl}#case-${index}`);
      assert.equal(client.locale, expected);
      assert.equal(rootElement.lang, 'uninitialized');
      assert.equal(client.t('agent.client.connectionNotReady'), expected === 'en-US'
        ? 'The Agent connection is not ready. Please retry.' : 'Agent 连接未就绪，请重试');
    }
  } finally {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
