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

/** Keep portable model packages in the runtime and private object references on the wire. */
export function createCloudDirectorModels(upload: (blob: Blob, name: string) => Promise<{ filePath: string }>, read: (path: string) => Promise<Blob>) {
  const uploaded = new Map<string, Promise<string>>();
  const packages = new Map<string, WeakRef<{ json: string; sha256: string }>>();
  const loadPackage = async (value: RecordValue): Promise<RecordValue> => {
    if (value.storage !== marker) return value;
    if (value.version !== 1 || typeof value.path !== 'string' || !/^cloud:\/\/media\/[^?#]+$/.test(value.path)
      || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('导演台模型存储引用无效');
    const cached = packages.get(value.path)?.deref();
    if (cached?.sha256 === value.sha256) return JSON.parse(cached.json) as RecordValue;
    const blob = await read(value.path);
    if (await digest(blob) !== value.sha256) throw new Error('导演台模型包校验失败');
    const json = await blob.text();
    const data: unknown = JSON.parse(json);
    assertPackage(data);
    packages.set(value.path, new WeakRef({ json, sha256: value.sha256 }));
    uploaded.set(value.sha256, Promise.resolve(value.path));
    return data;
  };
  const savePackage = async (value: RecordValue): Promise<RecordValue> => {
    if (value.storage === marker) { await loadPackage(value); return value; }
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
  return { save: <T>(value: T) => map(value, savePackage), load: <T>(value: T) => map(value, loadPackage) };
}
