type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const marker = 'shotloom-director-model';

export function isDirectorModelPackage(value: unknown): value is RecordValue {
  return record(value) && value.version === 1 && ['gltf', 'obj', 'fbx'].includes(String(value.format))
    && typeof value.entry === 'string' && Array.isArray(value.files)
    && value.files.every(file => record(file) && typeof file.path === 'string' && typeof file.data === 'string');
}

function assertPackage(value: unknown): asserts value is RecordValue {
  if (!isDirectorModelPackage(value)) throw new Error('导演台模型包格式无效');
}

async function digest(blob: Blob): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
}

function assertReference(value: RecordValue): asserts value is RecordValue & { path: string; sha256: string } {
  if (value.version !== 1 || typeof value.path !== 'string' || !/^cloud:\/\/media\/[^?#]+$/.test(value.path)
    || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('导演台模型存储引用无效');
}

export function hasCloudDirectorModels(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasCloudDirectorModels);
  return record(value) && (value.storage === marker || Object.values(value).some(hasCloudDirectorModels));
}

/** Resolve package bytes only when opening a director scene or making a portable export. */
export function createCloudDirectorModels(upload: (blob: Blob, name: string) => Promise<{ filePath: string }>, read: (path: string) => Promise<Blob>) {
  const uploaded = new Map<string, Promise<string>>();
  const packages = new Map<string, WeakRef<{ json: string; sha256: string }>>();
  const loading = new Map<string, Promise<RecordValue>>();
  const loadPackage = async (value: RecordValue): Promise<RecordValue> => {
    if (value.storage !== marker) return value;
    assertReference(value);
    const path = value.path;
    const cached = packages.get(path)?.deref();
    if (cached?.sha256 === value.sha256) return JSON.parse(cached.json) as RecordValue;
    const key = `${path}\0${value.sha256}`;
    let pending = loading.get(key);
    if (!pending) {
      pending = (async () => {
        const blob = await read(path);
        if (await digest(blob) !== value.sha256) throw new Error('导演台模型包校验失败');
        const json = await blob.text();
        const data: unknown = JSON.parse(json);
        assertPackage(data);
        packages.set(path, new WeakRef({ json, sha256: value.sha256 }));
        uploaded.set(value.sha256, Promise.resolve(path));
        return data;
      })().finally(() => loading.delete(key));
      loading.set(key, pending);
    }
    return structuredClone(await pending);
  };
  const savePackage = async (value: RecordValue): Promise<RecordValue> => {
    if (value.storage === marker) { assertReference(value); return value; }
    assertPackage(value);
    const json = JSON.stringify(value);
    const blob = new Blob([json], { type: 'application/json' });
    const sha256 = await digest(blob);
    let pending = uploaded.get(sha256);
    if (!pending) {
      pending = upload(blob, 'director-model.json').then(result => result.filePath);
      uploaded.set(sha256, pending);
      void pending.catch(() => { if (uploaded.get(sha256) === pending) uploaded.delete(sha256); });
    }
    const path = await pending;
    packages.set(path, new WeakRef({ json, sha256 }));
    return { storage: marker, version: 1, path, sha256 };
  };
  const map = async <T>(value: T, resolve: (value: RecordValue) => Promise<RecordValue>, depth = 0): Promise<T> => {
    if (depth > 128) throw new Error('项目数据嵌套层数过多');
    if (Array.isArray(value)) return await Promise.all(value.map(item => map(item, resolve, depth + 1))) as T;
    if (!record(value)) return value;
    const result: RecordValue = { ...value };
    for (const [key, item] of Object.entries(value)) {
      result[key] = key === 'package' && /^model-[a-f0-9]{64}$/.test(String(value.id)) && record(item)
        ? await resolve(item) : await map(item, resolve, depth + 1);
    }
    return result as T;
  };
  return {
    save: <T>(value: T) => map(value, savePackage),
    load: <T>(value: T) => map(value, async item => { if (item.storage === marker) assertReference(item); else assertPackage(item); return item; }),
    hydrate: <T>(value: T) => map(value, loadPackage),
  };
}
