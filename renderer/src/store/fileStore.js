import { reactive } from '@/store/domainReactivity';
import { desktopApi } from '@/services/desktopApi';

export const fileStore = reactive({
  downloadDir: '',
});

export async function loadDownloadDir() {
  fileStore.downloadDir = await desktopApi.file.getDownloadDir();
  return fileStore.downloadDir;
}

export async function selectDownloadDir() {
  fileStore.downloadDir = await desktopApi.file.selectDownloadDir();
  return fileStore.downloadDir;
}

export async function clearDownloadDir() {
  fileStore.downloadDir = await desktopApi.file.clearDownloadDir();
  return fileStore.downloadDir;
}

export async function showItemInFolder(filePath) {
  return desktopApi.file.showItemInFolder(filePath);
}
