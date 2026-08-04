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
  updateStore.progress = { received: 0, total: 0, percent: 0 };
  const result = await desktopApi.update.download((progress) => {
    updateStore.progress = progress;
  });
  if (!result.ok) {
    updateStore.error = result.error || '下载失败';
    updateStore.phase = 'available';
  } else {
    applyAvailable(result.info || updateStore.info, 'ready');
    const fileSize = result.info?.fileSize || updateStore.progress?.total || 0;
    updateStore.progress = { received: fileSize, total: fileSize, percent: 100 };
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
