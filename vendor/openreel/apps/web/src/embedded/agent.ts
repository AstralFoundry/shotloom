import { editorMessage } from "../shotloom-mode";
import { executeTool } from '@openreel/agent/executor';
import { getTool } from '@openreel/agent/registry';
import type { ProjectRef, CreateProjectOptions } from '@openreel/agent/host';
import { LiveEditorHost } from '../services/agent/live-host';
import { createExportJobRunner } from '../services/agent/export-job-runner';
import { useProjectStore } from '../stores/project-store';
import { loadProjectMedia, saveMediaBlob } from '../services/media-storage';
import { restoreMediaItem } from '../utils/media-recovery';
import type { ClipStudioHost, OpenReelNativeToolResult } from './runtime-types';
import { configureEmbeddedNativeExport } from './native-export';

/** Native tools only. Harness owns the loop, prompts, approvals and sessions. */
export function createEmbeddedAgent(host: ClipStudioHost) {
  const outputs: NonNullable<OpenReelNativeToolResult['outputs']> = [];
  const files = new Map<string, { filename: string; parts: Array<{ bytes: Uint8Array; offset: number }> }>();
  const receipts = new Map<string, NonNullable<OpenReelNativeToolResult['outputs']>[number]>();
  const filenameMime = (name: string) => ({ mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', wav: 'audio/wav', mp3: 'audio/mpeg', png: 'image/png', zip: 'application/zip' }[name.split('.').pop() || ''] || 'application/octet-stream');
  // This facade belongs to the embedded session's window, not Shotloom's window.
  const bridge = {
    fs: {
      showSaveDialog: async ({ defaultPath }: { defaultPath: string }) => defaultPath.split(/[\\/]/).pop() || 'export.mp4',
      tempFilePath: async (ext: string) => `export-${crypto.randomUUID()}.${ext}`,
      openWrite: async (filename: string) => { const id = crypto.randomUUID(); files.set(id, { filename, parts: [] }); return id; },
      writeChunk: async (id: string, data: ArrayBuffer | Uint8Array, offset: number) => {
        const file = files.get(id);
        if (!file || !Number.isSafeInteger(offset) || offset < 0) throw new Error(editorMessage("editor.native.streamOffset"));
        file.parts.push({ bytes: new Uint8Array(data instanceof ArrayBuffer ? data : data.slice()), offset });
      },
      closeWrite: async (id: string) => {
        const file = files.get(id); if (!file) throw new Error(editorMessage("editor.native.stream"));
        const bytes = new Uint8Array(file.parts.reduce((size, part) => Math.max(size, part.offset + part.bytes.byteLength), 0));
        for (const part of file.parts) bytes.set(part.bytes, part.offset);
        const receipt = await host.ui.saveAgentFile(file.filename, bytes.buffer, filenameMime(file.filename));
        receipts.set(file.filename, receipt); outputs.push(receipt); files.delete(id);
      },
      abortWrite: async (id: string) => { files.delete(id); },
    },
    media: {
      fetchUrl: async ({ url }: { url: string }) => {
        const result = await host.media.fetchAgentMedia(url);
        return { ok: true, status: 200, body: result.bytes, contentType: result.mime };
      },
    },
  };
  // Keep WebCodecs format normalization: this adapter is not Electron/Blender.
  window.openreel = { ...window.openreel, ...bridge } as unknown as typeof window.openreel;
  const nativeEncoding = host.nativeExport ? configureEmbeddedNativeExport(host.nativeExport, receipt => outputs.push(receipt)) : undefined;
  const runner = createExportJobRunner(nativeEncoding);
  class ScopedHost extends LiveEditorHost {
    // Native project lifecycle is constrained to the bound clip node's storage.
    async listProjects(): Promise<readonly ProjectRef[]> {
      return (await host.storage.get('agent-project-refs') as ProjectRef[] | null) || [];
    }
    async saveProject(): Promise<ProjectRef> {
      const current = this.getProject();
      const ref = { id: current.id, name: current.name, modifiedAt: current.modifiedAt };
      for (const item of current.mediaLibrary.items) {
        if (item.blob) await saveMediaBlob(current.id, item.id, item.blob, item.metadata);
      }
      await host.storage.set(`agent-project:${current.id}`, await import('../services/auto-save').then(module => module.serializeProjectForAutoSave(useProjectStore.getState().getFullProject())));
      const refs = await this.listProjects();
      await host.storage.set('agent-project-refs', [...refs.filter(item => item.id !== ref.id), ref]);
      host.project.changed();
      return ref;
    }
    async createProject(options: CreateProjectOptions): Promise<ProjectRef> {
      await this.saveProject();
      await super.createProject(options);
      return this.saveProject();
    }
    async openProject(id: string): Promise<ProjectRef> {
      if (!(await this.listProjects()).some(ref => ref.id === id)) throw new Error(editorMessage("editor.native.scope"));
      const project = await host.storage.get(`agent-project:${id}`);
      if (!project) throw new Error(editorMessage("editor.native.missingProject"));
      const restored = JSON.parse(String(project));
      const blobs = new Map((restored.mediaLibrary.items.length ? await loadProjectMedia(id) : []).map(item => [item.id, item.blob]));
      restored.mediaLibrary.items = await Promise.all(restored.mediaLibrary.items.map((item: Parameters<typeof restoreMediaItem>[0]) => restoreMediaItem(item, blobs.get(item.id))));
      useProjectStore.getState().loadProject(restored);
      return this.saveProject();
    }
  }
  const nativeHost = new ScopedHost({ jobRunner: async (kind, params) => {
    const result = await runner(kind, params);
    const path = (result.data as { path?: string } | undefined)?.path;
    const receipt = path ? receipts.get(path) : undefined;
    return receipt ? { ...result, data: { ...(result.data as object), path: receipt.filePath, filePath: receipt.filePath } } : result;
  } });
  return async (name: string, input: Record<string, unknown>): Promise<OpenReelNativeToolResult> => {
    const tool = getTool(name);
    if (!tool) return { ok: false, summary: editorMessage("editor.native.unknownTool"), error: { code: 'UNKNOWN_TOOL', message: name } };
    outputs.length = 0;
    const transaction = tool.readOnly ? undefined : nativeHost.beginTransaction(tool.title);
    try {
      let result = await executeTool(name, input, nativeHost);
      const geometry = result.data as { placeholder?: boolean; objects?: Array<{ placeholder?: boolean }> } | undefined;
      const deliversGeometry = name === 'bake_creation_asset' || (name === 'export_creation_scene_gltf' && input.includeGltf !== false);
      if (result.ok && deliversGeometry && (geometry?.placeholder === true || geometry?.objects?.some(object => object.placeholder))) {
        // Unsupported CPU generators produce boxes upstream. Never save those
        // boxes as the user's actual model/text geometry or retain a fake bake.
        result = { ok: false, summary: editorMessage("editor.native.geometry"), error: {
          code: 'UNSUPPORTED_GEOMETRY', message: 'OpenReel returned placeholder geometry. Use supported procedural geometry; model/text3d placeholders cannot be delivered as real meshes.',
        } };
      }
      if (transaction) {
        if (result.ok) nativeHost.commitTransaction(transaction, tool.title);
        else await nativeHost.rollbackTransaction(transaction);
      }
      host.project.changed();
      // CPU Creation previews return an image inside data rather than image.
      // Keep encoded image bytes out of the model's textual tool result.
      const data = result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? { ...result.data } as Record<string, unknown> : undefined;
      if (result.ok && data && (name === 'export_creation_scene_gltf' || name === 'bake_creation_asset')) {
        const gltf = data.gltf;
        const glbBase64 = data.glbBase64;
        if (gltf && typeof gltf === 'object') {
          const bytes = new TextEncoder().encode(JSON.stringify(gltf));
          outputs.push(await host.ui.saveAgentFile(`${data.sceneId || data.assetId || 'model'}.gltf`, bytes.buffer, 'model/gltf+json'));
          delete data.gltf;
        } else if (typeof glbBase64 === 'string' && glbBase64) {
          const raw = atob(glbBase64);
          const bytes = Uint8Array.from(raw, character => character.charCodeAt(0));
          outputs.push(await host.ui.saveAgentFile(`${data.sceneId || data.assetId || 'model'}.glb`, bytes.buffer, 'model/gltf-binary'));
          delete data.glbBase64;
        }
      }
      const dataUri = data?.dataUri;
      if (data && typeof dataUri === 'string' && dataUri.startsWith('data:image/png;base64,')) {
        delete data.dataUri;
        return { ...result, data, image: { dataUrl: dataUri, mimeType: 'image/png' }, ...(outputs.length ? { outputs: [...outputs] } : {}) };
      }
      return { ...result, ...(data ? { data } : {}), ...(outputs.length ? { outputs: [...outputs] } : {}) };
    } catch (error) {
      if (transaction) await nativeHost.rollbackTransaction(transaction);
      return { ok: false, summary: String(error), error: { code: 'OPENREEL_TOOL_FAILED', message: String(error) }, outputs: [...outputs] };
    }
  };
}
