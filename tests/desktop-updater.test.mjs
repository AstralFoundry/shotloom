import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('desktop updater keeps the checked update for download and installation', () => {
  const api = read('renderer/src/services/tauriApi.js');
  const store = read('renderer/src/store/updateStore.js');
  const dialog = read('renderer/src/app/components/UpdateDialog.tsx');
  const styles = read('renderer/styles.css');
  const checkFlow = store.slice(
    store.indexOf('export async function checkForUpdate'),
    store.indexOf('export async function downloadUpdate'),
  );

  assert.match(api, /pendingUpdate = update/);
  assert.match(api, /await update\.download\(/);
  assert.match(api, /cancelDownload: async \(\) =>/);
  assert.match(api, /checkFreshness: async \(\) =>/);
  assert.match(api, /await pendingUpdate\.install\(\)/);
  assert.match(api, /await relaunch\(\)/);
  assert.doesNotMatch(api, /尚未配置 Tauri updater/);
  assert.match(store, /desktopApi\.update\.download\(\(progress\) =>/);
  assert.match(store, /function transition\(event\)/);
  assert.match(store, /case 'UP_TO_DATE':[\s\S]*error: '', notice: event\.message/);
  assert.match(store, /scheduleRetry\(downloadUpdate/);
  assert.match(store, /applyAvailable\(result\.info \|\| updateStore\.info, 'ready'\)/);
  assert.match(store, /scheduleRetry\(checkForUpdate, '检查更新失败，请稍后重试'/);
  assert.doesNotMatch(checkFlow, /updateStore\.error = result\.error \|\|/);
  assert.match(dialog, /data\.checking[\s\S]*正在连接更新服务器/);
  assert.match(dialog, /button-spinner/);
  assert.match(dialog, /formatReleaseNotes/);
  assert.match(dialog, /update-current-state/);
  assert.match(dialog, /role="progressbar"/);
  assert.match(dialog, /data\.phase !== "downloading"/);
  assert.doesNotMatch(dialog, />\s*下载中\s*<\/button>/);
  assert.doesNotMatch(dialog, /SHOTLOOM DESKTOP/);
  assert.match(styles, /\.update-modal \{[\s\S]*border-radius: 22px/);
  assert.match(styles, /\.progress-track span \{[\s\S]*background: #59616a/);
});

test('release workflow publishes signed updater packages for every desktop target', () => {
  const workflow = read('.github/workflows/release.yml');

  assert.match(workflow, /bundle\/macos\/\*\.app\.tar\.gz/);
  assert.match(workflow, /bundle\/macos\/\*\.app\.tar\.gz\.sig/);
  assert.match(workflow, /--target aarch64-apple-darwin --bundles dmg,app/);
  assert.match(workflow, /--target x86_64-apple-darwin --bundles dmg,app/);
  assert.match(workflow, /renamed="\$\{archive%\.app\.tar\.gz\}_\$\{\{ matrix\.updater_suffix \}\}\.app\.tar\.gz"/);
  assert.match(workflow, /\*aarch64\*\.app\.tar\.gz\).*darwin-aarch64/);
  assert.match(workflow, /\*x86_64\*\.app\.tar\.gz\).*darwin-x86_64/);
  assert.match(workflow, /find release-assets -type f -name '\*\.sig' -print0/);
  assert.match(workflow, /find src-tauri\/target -type f -name '\*\.sig' -print0/);
  assert.match(workflow, /platform_count != 3/);
  assert.match(workflow, /Publishing unsigned and unnotarized macOS artifacts/);
  assert.match(workflow, /steps\.apple_signing\.outputs\.enabled == 'true'/);
});
