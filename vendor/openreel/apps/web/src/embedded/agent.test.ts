import { configureShotloomLocale } from "../shotloom-mode";
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from '../stores/project-store';
import { createEmbeddedAgent } from './agent';
import type { ClipStudioHost } from './runtime-types';

function fixture(options: { saveError?: string } = {}) {
  const storage = new Map<string, unknown>();
  const saved: Array<{ filename: string; bytes: ArrayBuffer }> = [];
  const host = {
    project: { changed() {} },
    storage: {
      get: async (key: string) => storage.get(key) ?? null,
      set: async (key: string, value: unknown) => { storage.set(key, value); },
    },
    media: { fetchAgentMedia: async () => { throw new Error('Network not enabled in this test'); } },
    ui: { saveAgentFile: async (filename: string, bytes: ArrayBuffer) => {
      if (options.saveError) throw new Error(options.saveError);
      saved.push({ filename, bytes });
      return { filePath: `/project/assets/${filename}`, filename, size: bytes.byteLength };
    } },
  } as unknown as ClipStudioHost;
  return { execute: createEmbeddedAgent(host), saved, storage };
}

afterEach(() => configureShotloomLocale("en-US"));

describe('Shotloom native OpenReel adapter', () => {
  beforeEach(() => {
    delete window.openreel;
    useProjectStore.getState().createNewProject();
  });

  it('executes native read/write tools and preserves a single undo group', async () => {
    const { execute } = fixture();
    const before = useProjectStore.getState().project.timeline.tracks.length;
    const added = await execute('add_track', { trackType: 'audio' });
    expect(added.ok).toBe(true);
    expect((await execute('get_editor_state', {})).data).toMatchObject({ trackCount: before + 1 });
    await useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.timeline.tracks.length).toBe(before);
    expect((await execute('get_clip', { clipId: 'missing' })).data).toBeUndefined();
    expect((await execute('remove_track', { trackId: 'missing' })).ok).toBe(false);
    expect((await execute('nonexistent', {})).error?.code).toBe('UNKNOWN_TOOL');
  });

  it('persists native Motion state and restores only node-owned projects', async () => {
    const { execute } = fixture();
    const created = await execute('create_motion_composition', { name: 'Shotloom title', duration: 3 });
    expect(created.ok).toBe(true);
    const compositionId = (created.data as { compositionId: string }).compositionId;
    expect((await execute('add_motion_layer', { compositionId, layerType: 'text', text: 'Hello' })).ok).toBe(true);
    const saved = await execute('save_project', {});
    expect(saved.ok).toBe(true);
    const projectId = useProjectStore.getState().project.id;
    expect((await execute('create_project', { name: 'Second' })).ok).toBe(true);
    expect((await execute('open_project', { id: 'another-node-project' })).ok).toBe(false);
    const opened = await execute('open_project', { id: projectId });
    expect(opened.ok).toBe(true);
    const scene = useProjectStore.getState().project.motionCompositions?.find(item => item.id === compositionId);
    expect(scene?.name).toBe('Shotloom title');
    expect(scene?.layers.some(layer => layer.type === 'text' && layer.text === 'Hello')).toBe(true);
  });

  it('writes actual export chunks through the product file bridge', async () => {
    const { saved } = fixture();
    const fs = window.openreel!.fs;
    const id = await fs.openWrite('test.wav');
    await fs.writeChunk(id, new Uint8Array([1, 2, 3]).buffer, 0);
    await fs.writeChunk(id, new Uint8Array([4]).buffer, 1);
    await fs.closeWrite(id);
    expect(saved[0].filename).toBe('test.wav');
    expect([...new Uint8Array(saved[0].bytes)]).toEqual([1, 4, 3]);
    await expect(fs.writeChunk(id, new ArrayBuffer(1), 0)).rejects.toThrow('Unknown export stream');
  });

  it('reports an unavailable rigging backend instead of claiming success', async () => {
    const { execute } = fixture();
    const probe = await execute('probe_rigging_backend', {});
    expect(probe.data).toMatchObject({ available: false, provider: 'blender' });
  });

  it('persists real Creation glTF and GLB bytes and returns compact file receipts', async () => {
    const { execute, saved } = fixture();
    const created = await execute('create_creation_3d_scene', { name: 'File export', objects: [{ kind: 'box', name: 'Cube' }] });
    expect(created.ok).toBe(true);
    const sceneId = (created.data as { sceneId: string }).sceneId;
    const stats = await execute('export_creation_scene_gltf', { sceneId, includeGltf: false });
    expect(stats.ok).toBe(true);
    expect(saved).toHaveLength(0);
    const gltf = await execute('export_creation_scene_gltf', { sceneId });
    expect(gltf.ok).toBe(true);
    expect(gltf.outputs?.[0].filename).toMatch(/\.gltf$/);
    const document = JSON.parse(new TextDecoder().decode(saved[0].bytes));
    expect(document.asset.version).toBe('2.0');
    expect(document.meshes.length).toBeGreaterThan(0);
    expect(document.buffers[0].uri).toMatch(/^data:application\/octet-stream;base64,/);
    expect(gltf.data).not.toHaveProperty('gltf');
    const glb = await execute('export_creation_scene_gltf', { sceneId, format: 'glb' });
    expect(glb.ok).toBe(true);
    expect(glb.outputs?.[0].size).toBe(saved[1].bytes.byteLength);
    expect(new TextDecoder().decode(saved[1].bytes.slice(0, 4))).toBe('glTF');
    expect(new DataView(saved[1].bytes).getUint32(8, true)).toBe(saved[1].bytes.byteLength);
    expect(glb.data).not.toHaveProperty('glbBase64');
  });

  it('does not report a model file as delivered when storage rejects the write', async () => {
    const { execute } = fixture({ saveError: 'Disk is read-only' });
    const created = await execute('create_creation_3d_scene', { name: 'Failed export', objects: [{ kind: 'sphere' }] });
    const sceneId = (created.data as { sceneId: string }).sceneId;
    const result = await execute('export_creation_scene_gltf', { sceneId });
    expect(result.ok).toBe(false);
    expect(result.outputs).toEqual([]);
    expect(result.error?.message).toContain('Disk is read-only');
  });

  it('rejects placeholder geometry delivery and rolls back its unsupported mesh cache', async () => {
    const { execute, saved } = fixture();
    const created = await execute('create_creation_3d_scene', { name: 'Unsupported text mesh', objects: [{ kind: 'text3d', text: 'Real lettering' }] });
    expect(created.ok).toBe(true);
    const sceneId = (created.data as { sceneId: string }).sceneId;
    const asset = useProjectStore.getState().project.creation!.assets[0];
    const before = JSON.stringify(asset.caches);
    const stats = await execute('export_creation_scene_gltf', { sceneId, includeGltf: false });
    expect(stats.ok).toBe(true);
    expect((stats.data as { objects: Array<{ placeholder: boolean }> }).objects.some(object => object.placeholder)).toBe(true);
    for (const format of ['gltf', 'glb']) {
      const result = await execute('export_creation_scene_gltf', { sceneId, format });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('UNSUPPORTED_GEOMETRY');
      expect(result.outputs).toBeUndefined();
    }
    const baked = await execute('bake_creation_asset', { assetId: asset.id, includeGltf: true });
    expect(baked.ok).toBe(false);
    expect(baked.error?.code).toBe('UNSUPPORTED_GEOMETRY');
    expect(JSON.stringify(useProjectStore.getState().project.creation!.assets.find(item => item.id === asset.id)!.caches)).toBe(before);
    expect(saved).toHaveLength(0);
  });
});

it("translates owned stream and scoped project failures while preserving tool IDs", async () => {
  configureShotloomLocale("zh-CN");
  const { execute, storage, saved } = fixture();
  const fs = window.openreel!.fs;
  await expect(fs.writeChunk("missing", new ArrayBuffer(1), 0)).rejects.toThrow("导出流不存在或写入偏移无效。");
  await expect(fs.closeWrite("missing")).rejects.toThrow("导出流不存在。");
  const unknown = await execute("User {name} $&", {});
  expect(unknown).toMatchObject({ ok: false, summary: "未知的 OpenReel 工具", error: { code: "UNKNOWN_TOOL", message: "User {name} $&" } });
  const outside = await execute("open_project", { id: "not-owned" });
  expect(outside.ok).toBe(false);
  expect(outside.summary).toContain("工程不属于当前绑定的剪辑节点。");
  storage.set("agent-project-refs", [{ id: "owned-but-missing", name: "User {name}", modifiedAt: Date.now() }]);
  const missing = await execute("open_project", { id: "owned-but-missing" });
  expect(missing.ok).toBe(false);
  expect(missing.summary).toContain("已保存的工程不存在。");
  expect(saved).toHaveLength(0);
});
