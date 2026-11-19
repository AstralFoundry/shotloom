import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const carrier = fileURLToPath(new URL('../client-dist/client.js', import.meta.url));
const boot = new URL('../client-dist/boot.json', import.meta.url);

test('built Harness carrier imports when JavaScript code generation is disabled', () => {
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-', carrier], {
    encoding: 'utf8',
    timeout: 30_000,
    input: String.raw`
      import assert from 'node:assert/strict';
      import { readFileSync } from 'node:fs';
      import vm from 'node:vm';

      const moduleUrl = 'shotloom://app/harness/client.js';
      const context = vm.createContext({
        console, URL, URLSearchParams, TextEncoder, TextDecoder,
        queueMicrotask, structuredClone, setTimeout, clearTimeout, setInterval, clearInterval, addEventListener() {}, removeEventListener() {},
        navigator: { language: 'en-US' },
        document: { compatMode: 'CSS1Compat', createElement: () => ({ style: {}, setAttribute() {} }) }, location: { href: 'shotloom://app/index.html' },
      }, { codeGeneration: { strings: false, wasm: true } });
      context.window = context;
      context.self = context;
      const code = readFileSync(process.argv[2], 'utf8');
      // Test-only export of the actual loader configuration function in the bundled module.
      const carrier = new vm.SourceTextModule(code + '\nexport { interpolate as testInterpolate };', {
        context, identifier: moduleUrl,
        initializeImportMeta(meta) { meta.url = moduleUrl; },
      });
      await carrier.link(specifier => { throw new Error('Unresolved carrier import: ' + specifier); });
      await carrier.evaluate({ timeout: 5_000 });
      assert.equal(typeof carrier.namespace.initialize, 'function');
      assert.equal(typeof carrier.namespace.mount, 'function');
      const staticConfig = vm.runInContext('({ modules: [{ enabled: true }, "chat"], retries: 0 })', context);
      assert.equal(JSON.stringify(carrier.namespace.testInterpolate({}, staticConfig)), JSON.stringify(staticConfig));
      const expression = vm.runInContext('({ nested: [{ __jsExpr: "23 + 19" }] })', context);
      assert.throws(() => carrier.namespace.testInterpolate({}, expression), {
        message: /Dynamic YAML expressions are unavailable in the native Harness client/,
      });
    `,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('the carrier stages all static registration modules listed by its boot graph', () => {
  const graph = JSON.parse(readFileSync(boot, 'utf8'));
  assert.ok(graph.entries.length > 0);
  assert.ok(graph.entries.some(({ id }) => id === '@deepseek-ai/dsh-client-modules'));
  const nativeModules = readFileSync(new URL('../client-dist/native-modules.js', import.meta.url), 'utf8');
  assert.equal((nativeModules.match(/^import r\d+ /gm) || []).length, graph.entries.length);
  for (const { id } of graph.entries) {
    const registration = readFileSync(new URL('../client-dist/plugins/' + id + '/native.js', import.meta.url), 'utf8');
    assert.match(registration, /^export default function register\(window, document, globalThis = window\)/);
  }
});

test('renderer still denies JavaScript string evaluation and keeps Electron isolation enabled', () => {
  const html = readFileSync(new URL('../../../renderer/index.html', import.meta.url), 'utf8');
  const csp = html.match(/script-src ([^;]+);/)?.[1]?.trim().split(/\s+/);
  assert.deepEqual(csp, ["'self'", "'wasm-unsafe-eval'", 'blob:']);
  const main = readFileSync(new URL('../../../electron/main.ts', import.meta.url), 'utf8');
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /webSecurity:\s*true/);
});
