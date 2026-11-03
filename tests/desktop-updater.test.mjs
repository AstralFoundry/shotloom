import assert from 'node:assert/strict';

import test from 'node:test';
import { readLocalizedSource as readSource } from './helpers/sourceContract.mjs';

const read = (path) => readSource(path);

test('desktop updater keeps the checked update for download and installation', () => {
  const api = read('renderer/src/services/tauriApi.ts');
  const store = read('renderer/src/store/updateStore.ts');
  const dialog = read('renderer/src/app/components/UpdateDialog.tsx');
  const styles = read('renderer/styles/dialogs.css');
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
  assert.match(store, /desktopApi\.update\.download\(\(progress: UpdateProgress\) =>/);
  assert.match(store, /function transition\(event: AnyRecord\)/);
  assert.match(store, /case 'UP_TO_DATE':[\s\S]*error: '', notice: event\.message/);
  assert.match(store, /scheduleRetry\(downloadUpdate/);
  assert.match(store, /applyAvailable\(result\.info \|\| updateStore\.info, 'ready'\)/);
  assert.match(store, /scheduleRetry\(checkForUpdate, ["']检查更新失败，请稍后重试["']/);
  assert.doesNotMatch(checkFlow, /updateStore\.error = result\.error \|\|/);
  assert.match(dialog, /data\.checking[\s\S]*正在连接更新服务器/);
  assert.match(dialog, /button-spinner/);
  assert.match(dialog, /formatReleaseNotes/);
  assert.match(dialog, /update-current-state/);
  assert.match(dialog, /role="progressbar"/);
  assert.match(dialog, /data\.phase !== "downloading"/);
  assert.doesNotMatch(dialog, />\s*下载中\s*<\/button>/);
  assert.doesNotMatch(dialog, /SHOTLOOM DESKTOP/);
  // 更新对话框只是 .modal 的一个宽度变体，圆角/底色/抬升沿用应用级模态框契约。
  assert.match(styles, /\.update-modal \{\s*width: min\(456px[^}]*\}/);
  assert.match(styles, /\.modal \{[\s\S]*?border-radius: var\(--radius-lg\)[\s\S]*?box-shadow: var\(--shadow-modal\)/);
  assert.match(styles, /\.update-modal-head \.icon-btn \{[^}]*border-radius: var\(--radius-control\)/);
  assert.match(styles, /\.progress-track span \{[\s\S]*background: var\(--brand\)/);
});
