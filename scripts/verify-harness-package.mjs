import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

for (const name of ['client.js', 'worker/worker.mjs', 'worker/runtime.js', 'worker/modules.mjs', 'worker/image.tar.gz', 'worker/local-storage.mjs']) {
  const data = await readFile(new URL('../renderer/public/harness/' + name, import.meta.url));
  assert.ok(data.length, `Missing Agent package: ${name}`);
  if (name.endsWith('.gz')) assert.equal(data.subarray(0, 2).toString('hex'), '1f8b');
}
const checked = spawnSync(process.execPath, ['--test', 'harness/host/test/browser-worker.test.mjs'], {
  stdio: 'inherit', env: { ...process.env, SHOTLOOM_BROWSER_TESTS: '1' },
});
if (checked.status !== 0) process.exit(checked.status ?? 1);
console.log('Worker package, official chat UI, tool continuation and local history recovery: PASS');
