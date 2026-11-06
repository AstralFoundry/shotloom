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
  // 进度条改由 antd Progress 提供，仍必须受控于下载百分比并保留下载态语义。
  assert.match(dialog, /<Progress[\s\S]*?percent=\{percent\}[\s\S]*?status="active"/);
  assert.match(dialog, /data\.phase !== "downloading"/);
  assert.doesNotMatch(dialog, />\s*下载中\s*<\/button>/);
  assert.doesNotMatch(dialog, /SHOTLOOM DESKTOP/);
  // 更新对话框由 antd Modal 承载：宽度、可关闭性与遮罩行为必须跟随下载/强制更新状态。
  assert.match(dialog, /<Modal[\s\S]*?width=\{456\}/);
  assert.match(dialog, /closable=\{closeAllowed\}/);
  assert.match(dialog, /mask=\{\{ closable: closeAllowed, blur: true \}\}/);
  assert.match(styles, /\.update-progress \{/);
  assert.match(styles, /\.update-current-state \{/);
  // 主题桥必须把 antd 容器、圆角和抬升接到应用令牌上，而不是另起一套视觉语言。
  const antdTheme = read('renderer/styles/antd-theme.css');
  assert.match(antdTheme, /--ant-color-bg-container: var\(--surface\)/);
  assert.match(antdTheme, /--ant-border-radius: var\(--radius\)/);
  assert.match(antdTheme, /--ant-box-shadow-secondary: var\(--shadow-card\)/);
});
