import { reactive } from '@/store/domainReactivity';
import { desktopApi } from '@/services/desktopApi';

export const updateStore = reactive({
  phase: 'idle',
  info: null,
  progress: null,
  error: '',
  dialogOpen: false,
  checking: false,
});

function applyAvailable(info, phase = 'available') {
  updateStore.info = info || null;
  updateStore.phase = info ? phase : 'idle';
  updateStore.error = '';
  if (info) updateStore.dialogOpen = true;
}

export function registerUpdateBridge() {
  const unregister = [
    desktopApi.update.onAvailable((info) => applyAvailable(info, 'available')),
    desktopApi.update.onDownloadProgress((progress) => {
      updateStore.progress = progress;
      updateStore.phase = 'downloading';
      updateStore.error = '';
      updateStore.dialogOpen = true;
    }),
    desktopApi.update.onReady((info) => {
      applyAvailable(info, 'ready');
      updateStore.progress = { received: info?.fileSize || 0, total: info?.fileSize || 0, percent: 100 };
    }),
    desktopApi.update.onError((message) => {
      updateStore.error = message || '更新失败';
      updateStore.phase = updateStore.info ? updateStore.phase : 'idle';
      updateStore.dialogOpen = true;
    }),
  ];
  return () => unregister.forEach((fn) => fn?.());
}

export async function checkForUpdate({ openWhenNone = false } = {}) {
  updateStore.checking = true;
  try {
    const result = await desktopApi.update.check();
    if (result.info) {
      applyAvailable(result.info, result.downloaded ? 'ready' : 'available');
    } else if (openWhenNone) {
      updateStore.info = null;
      updateStore.phase = 'idle';
      updateStore.error = result.error || '当前已是最新版本';
      updateStore.dialogOpen = true;
    }
    return result;
  } finally {
    updateStore.checking = false;
  }
}

export async function downloadUpdate() {
  updateStore.phase = 'downloading';
  updateStore.error = '';
  const result = await desktopApi.update.download();
  if (!result.ok) {
    updateStore.error = result.error || '下载失败';
    updateStore.phase = 'available';
  }
  return result;
}

export async function executeUpdateRestart() {
  updateStore.error = '';
  const result = await desktopApi.update.executeRestart();
  if (!result.ok) {
    updateStore.error = result.error || '启动安装失败';
  }
  return result;
}
