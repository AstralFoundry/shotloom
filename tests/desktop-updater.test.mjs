import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('desktop updater keeps the checked update for download and installation', () => {
  const api = read('renderer/src/services/tauriApi.js');
  const store = read('renderer/src/store/updateStore.js');

  assert.match(api, /pendingUpdate = update/);
  assert.match(api, /await pendingUpdate\.download\(/);
  assert.match(api, /await pendingUpdate\.install\(\)/);
  assert.match(api, /await relaunch\(\)/);
  assert.doesNotMatch(api, /尚未配置 Tauri updater/);
  assert.match(store, /desktopApi\.update\.download\(\(progress\) =>/);
  assert.match(store, /applyAvailable\(result\.info \|\| updateStore\.info, 'ready'\)/);
});

test('release workflow publishes signed updater packages for every desktop target', () => {
  const workflow = read('.github/workflows/release.yml');

  assert.match(workflow, /bundle\/macos\/\*\.app\.tar\.gz/);
  assert.match(workflow, /bundle\/macos\/\*\.app\.tar\.gz\.sig/);
  assert.match(workflow, /\*aarch64\*\.app\.tar\.gz\).*darwin-aarch64/);
  assert.match(workflow, /\*x86_64\*\.app\.tar\.gz\).*darwin-x86_64/);
  assert.match(workflow, /find release-assets -type f -name '\*\.sig' -print0/);
  assert.match(workflow, /platform_count != 3/);
  assert.match(workflow, /Publishing unsigned and unnotarized macOS artifacts/);
  assert.match(workflow, /steps\.apple_signing\.outputs\.enabled == 'true'/);
});
