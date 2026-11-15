import { invoke as nativeInvoke, type InvokeArgs } from '@tauri-apps/api/core';
import { localizeNativeError, t } from '../i18n/index.ts';
import type { ClipStudioNativeExport, NativeExportReceipt } from '../../../vendor/openreel/apps/web/src/embedded/runtime-types';
import { cloudEnabled } from '../utils/cloudConfig';
const platformApi = async () => (await import('./desktopApi')).desktopApi;

async function invoke<T>(command: string, args: InvokeArgs): Promise<T> {
  try { return await nativeInvoke<T>(command, args); }
  catch (error) {
    const message = localizeNativeError(error);
    if (message === undefined) throw error;
    throw new Error(message);
  }
}

/** The runtime owns opaque jobs; filenames and filesystem destinations stay native. */
export function createNativeEditorExport(projectDir: string, assertOwner: () => void) {
  const jobs = new Set<string>();
  const finishing = new Set<string>();
  const workspaces = new Map<string, string>();
  const release = async (jobId: string) => {
    const id = workspaces.get(jobId);
    workspaces.delete(jobId);
    if (id) await invoke('cloud_media_release', { id });
  };
  const checkJob = (id: string) => {
    assertOwner();
    if (!jobs.has(id)) throw new Error(t('editor.nativeExport.wrongOwner'));
  };
  const cancel = async (jobId: string) => {
    if (!jobs.delete(jobId)) return;
    try { await invoke('openreel_export_cancel', { jobId }); }
    finally { if (!finishing.has(jobId)) await release(jobId); }
  };
  const bridge: ClipStudioNativeExport = {
    start: async settings => {
      assertOwner();
      const workspace = cloudEnabled ? await invoke<{ id: string; path: string }>('cloud_media_workspace', {}) : undefined;
      let id: string;
      try {
        id = workspace ? await invoke<string>('openreel_cloud_export_start', { workspaceId: workspace.id, settings })
          : await invoke<string>('openreel_export_start', { projectDir, settings });
      } catch (error) {
        if (workspace) await invoke('cloud_media_release', { id: workspace.id });
        throw error;
      }
      if (workspace) workspaces.set(id, workspace.id);
      jobs.add(id);
      try { assertOwner(); } catch (error) { await cancel(id); throw error; }
      return id;
    },
    write: async (jobId, kind, bytes, position) => {
      checkJob(jobId);
      const data = new Uint8Array(bytes);
      let binary = '';
      for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
      await invoke('openreel_export_write', { jobId, kind, data: btoa(binary), position });
      assertOwner();
    },
    finish: async jobId => {
      checkJob(jobId);
      finishing.add(jobId);
      try {
        const receipt = await invoke<NativeExportReceipt>('openreel_export_finish', { jobId });
        checkJob(jobId);
        if (!cloudEnabled) return receipt;
        const saved = await (await platformApi()).file.copyToProject(receipt.filePath, receipt.filename);
        checkJob(jobId);
        return { ...receipt, filePath: saved.filePath, size: saved.size };
      } finally { finishing.delete(jobId); jobs.delete(jobId); await release(jobId); }
    },
    cancel,
  };
  return { bridge, dispose: async () => { await Promise.allSettled([...jobs].map(cancel)); } };
}
