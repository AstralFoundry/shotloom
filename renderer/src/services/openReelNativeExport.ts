import { invoke as nativeInvoke, type InvokeArgs } from '@tauri-apps/api/core';
import { localizeNativeError, t } from '../i18n/index.ts';
import type { ClipStudioNativeExport, NativeExportReceipt } from '../../../vendor/openreel/apps/web/src/embedded/runtime-types';

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
  const checkJob = (id: string) => {
    assertOwner();
    if (!jobs.has(id)) throw new Error(t('editor.nativeExport.wrongOwner'));
  };
  const cancel = async (jobId: string) => {
    if (!jobs.delete(jobId)) return;
    await invoke('openreel_export_cancel', { jobId });
  };
  const bridge: ClipStudioNativeExport = {
    start: async settings => {
      assertOwner();
      const id = await invoke<string>('openreel_export_start', { projectDir, settings });
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
      try {
        const receipt = await invoke<NativeExportReceipt>('openreel_export_finish', { jobId });
        assertOwner();
        return receipt;
      } finally { jobs.delete(jobId); }
    },
    cancel,
  };
  return { bridge, dispose: async () => { await Promise.allSettled([...jobs].map(cancel)); } };
}
