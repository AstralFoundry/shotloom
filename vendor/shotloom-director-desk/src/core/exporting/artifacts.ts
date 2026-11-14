import { deliverMedia } from '../host-delivery.ts';
import { download } from '../storage.ts';

export interface Artifact {
    id: string; owner: string; filename: string; kind: 'video' | 'image' | 'document' | 'bundle';
    mime: string; bytes: number; createdAt: number; metadata: Record<string, unknown>;
    persistence: 'stored' | 'memory'; ingestion: 'pending' | 'completed' | 'failed';
    delivery?: unknown; error?: string; storageWarning?: string;
}
function publicArtifact(a: Artifact): Artifact {
    const { document: _document, ...metadata } = a.metadata;
    return { ...a, metadata };
}
type RecordWithBlob = { artifact: Artifact; blob: Blob; context?: unknown };
/** Durable bytes are separate from render jobs: retrying delivery never invokes the encoder. */
export class ExportArtifacts {
    private memory = new Map<string, RecordWithBlob>();
    private urls = new Map<string, string>();
    private pending = new Map<string, Promise<Artifact>>();
    private db?: Promise<IDBDatabase>;
    private database() {
        return this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open('shotloom-director-artifacts', 1);
            req.onupgradeneeded = () => req.result.createObjectStore('artifacts', { keyPath: 'artifact.id' });
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    private async store(record: RecordWithBlob) {
        const db = await this.database();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('artifacts', 'readwrite'); tx.objectStore('artifacts').put(record);
            tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
        });
    }
    async retain(owner: string, blob: Blob, filename: string, kind: Artifact['kind'], metadata: Record<string, unknown> = {}, context?: unknown) {
        if (!owner) throw Error('导出缺少工程标识');
        const artifact: Artifact = { id: crypto.randomUUID(), owner, filename, kind, mime: blob.type, bytes: blob.size, createdAt: Date.now(), metadata, persistence: 'stored', ingestion: 'pending' };
        const record = { artifact, blob, context }; this.memory.set(artifact.id, record);
        try { await this.store(record); } catch (error) { artifact.persistence = 'memory'; artifact.storageWarning = `持久存储失败，关闭页面前请下载：${String(error)}`; }
        return publicArtifact(artifact);
    }
    private async record(owner: string, id: string) {
        let record = this.memory.get(id);
        if (!record) {
            const db = await this.database();
            record = await new Promise<RecordWithBlob | undefined>((resolve, reject) => {
                const req = db.transaction('artifacts').objectStore('artifacts').get(id); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
            });
        }
        if (!record || record.artifact.owner !== owner) throw Error('当前工程中不存在此导出产物');
        this.memory.set(id, record); return record;
    }
    async list(owner: string) {
        const records = new Map(this.memory);
        try {
            const db = await this.database();
            const all = await new Promise<RecordWithBlob[]>((resolve, reject) => { const req = db.transaction('artifacts').objectStore('artifacts').getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
            for (const r of all) if (!records.has(r.artifact.id)) records.set(r.artifact.id, r);
        } catch { /* Memory-only artifacts remain downloadable when browser storage is unavailable. */ }
        return [...records.values()].filter(r => r.artifact.owner === owner).map(r => publicArtifact(r.artifact));
    }
    async read(owner: string, id: string) {
        const record = await this.record(owner, id);
        let url = this.urls.get(id); if (!url) { url = URL.createObjectURL(record.blob); this.urls.set(id, url); }
        return { ...publicArtifact(record.artifact), url, urlLifetime: 'current-page; use artifactId to resolve after reload' };
    }
    async sourceDocument(owner: string, id: string) { return (await this.record(owner, id)).artifact.metadata.document; }
    async blob(owner: string, id: string) { return (await this.record(owner, id)).blob; }
    async deliver(owner: string, id: string, mode: 'ingest' | 'download') {
        const key = `${owner}:${id}:${mode}`;
        const running = this.pending.get(key); if (running) return running;
        const task = this.deliverOnce(owner, id, mode); this.pending.set(key, task);
        try { return await task; } finally { this.pending.delete(key); }
    }
    private async deliverOnce(owner: string, id: string, mode: 'ingest' | 'download') {
        const record = await this.record(owner, id), a = record.artifact;
        if (mode === 'download') { download(record.blob, a.filename); return { ...publicArtifact(a), downloadTriggered: true }; }
        if (a.ingestion === 'completed') return publicArtifact(a);
        if (a.kind !== 'image' && a.kind !== 'video') throw Error('文档与交付包请使用 download 模式');
        try {
            a.delivery = await deliverMedia(record.blob, a.filename, a.kind, record.context, a.id);
            a.ingestion = window.parent === window ? 'pending' : 'completed'; delete a.error;
        } catch (error) { a.ingestion = 'failed'; a.error = String(error); }
        try { if (a.persistence === 'stored') await this.store(record); } catch (error) { a.persistence = 'memory'; a.storageWarning = `状态持久化失败，关闭页面前请下载：${String(error)}`; }
        return publicArtifact(a);
    }
    async remove(owner: string, id: string) {
        const record = await this.record(owner, id);
        if ([...this.pending.keys()].some(key => key.startsWith(`${owner}:${id}:`))) throw Error('产物正在交付，请完成后再删除');
        try {
            const db = await this.database();
            await new Promise<void>((resolve, reject) => { const tx = db.transaction('artifacts', 'readwrite'); tx.objectStore('artifacts').delete(id); tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error); });
        } catch (error) { if (record.artifact.persistence === 'stored') throw error; }
        this.memory.delete(id); const url = this.urls.get(id); if (url) URL.revokeObjectURL(url); this.urls.delete(id);
        return { removed: true, artifactId: id };
    }
}
