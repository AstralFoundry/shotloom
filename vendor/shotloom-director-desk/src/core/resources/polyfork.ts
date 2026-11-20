import { strToU8, zipSync } from 'fflate';
import { packModelFilesAsync } from './model-import-worker.ts';
import { decodeModelBytes } from './model-package.ts';
import { modelResourceId, type ModelResource } from './project-resources.ts';
import { readLocalModel, saveLocalModel } from './local-model-library.ts';

export interface PolyforkAsset {
    id: string;
    title: string;
    free: boolean;
    class?: string | null;
    thumbnail?: string | null;
    triangles?: number | null;
    size_m?: { x: number; y: number; z: number } | null;
    has_skeleton?: boolean | null;
}
export interface PolyforkDetail extends PolyforkAsset {
    credit: string;
    license: string;
    licenseUrl: string;
    source: string;
    download: { glb: string };
}
export interface PolyforkResults { assets: PolyforkAsset[]; total: number; page: number; per_page: number }
async function request(path: string, signal?: AbortSignal) {
    const response = await fetch(`/api/polyfork${path}`, {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
    });
    if (!response.ok) {
        const error = await response.json().catch(() => null) as { message?: string } | null;
        throw Error(error?.message || `模型仓库请求失败：HTTP ${response.status}`);
    }
    return response;
}
async function json<T>(path: string, signal?: AbortSignal): Promise<T> {
    const reply = await (await request(path, signal)).json() as { success: boolean; data: T; message?: string };
    if (!reply.success) throw Error(reply.message || '模型仓库响应无效');
    return reply.data;
}
function modelId(id: string) {
    if (!/^[a-z0-9][a-z0-9-]{0,159}$/.test(id)) throw Error('Polyfork 模型 ID 无效');
    return id;
}
export function searchPolyforkModels(query = '', page = 1, signal?: AbortSignal): Promise<PolyforkResults> {
    if (!Number.isSafeInteger(page) || page < 1) throw Error('模型页码无效');
    return json(`/assets?${new URLSearchParams({ q: query, page: String(page), per_page: '24' })}`, signal);
}
export function getPolyforkModel(id: string, signal?: AbortSignal): Promise<PolyforkDetail> {
    return json(`/assets/${modelId(id)}`, signal);
}
export async function downloadPolyforkModel(id: string, signal?: AbortSignal) {
    const asset = await getPolyforkModel(id, signal);
    const bytes = new Uint8Array(await (await request(`/assets/${modelId(id)}/model`, signal)).arrayBuffer());
    const entry = `${id}.glb`;
    const pack = await packModelFilesAsync(entry, [{ path: entry, bytes }], signal);
    const resource: ModelResource = {
        id: await modelResourceId(pack, signal), name: asset.title, package: pack,
        copyright: asset.credit,
        license: `CC BY 4.0\n${asset.licenseUrl}\n${asset.license}\nOriginal mesh; no changes.`,
        source: `${asset.source}\n${asset.download.glb}\nRetrieved: ${new Date().toISOString()}`,
    };
    return { asset, resource };
}
export async function obtainPolyforkModel(id: string, signal?: AbortSignal): Promise<ModelResource> {
    const key = modelId(id);
    const existing = await readLocalModel(key);
    signal?.throwIfAborted();
    if (existing) return existing;
    const { asset, resource } = await downloadPolyforkModel(key, signal);
    signal?.throwIfAborted();
    try {
        await saveLocalModel(key, resource, asset.class ?? undefined);
    } catch {
        throw Error('本地模型保存失败，请检查磁盘空间后重试');
    }
    return resource;
}

export async function rememberProjectPolyforkModels(resources: readonly ModelResource[]) {
    for (const resource of resources) {
        const id = /^https:\/\/polyfork\.dev\/asset\/([a-z0-9][a-z0-9-]{0,159})$/.exec(resource.source.split('\n')[0])?.[1];
        if (id && resource.package.entry === `${id}.glb` && resource.copyright.includes('CC BY 4.0') &&
            resource.license.startsWith('CC BY 4.0\n') && !(await readLocalModel(id))) {
            await saveLocalModel(id, resource);
        }
    }
}
export function polyforkModelBundle(resource: ModelResource) {
    const files = Object.fromEntries(resource.package.files.map(file => [file.path, decodeModelBytes(file.data)]));
    files['LICENSE.txt'] = strToU8(`${resource.copyright}\n\n${resource.license}\n\n${resource.source}\n`);
    return new Blob([new Uint8Array(zipSync(files))], { type: 'application/zip' });
}
