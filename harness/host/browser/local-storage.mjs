const DATABASE = 'shotloom-agent-worker-v1';
let opening;
export function openDatabase() {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'key' }).createIndex('owner', 'owner');
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('请关闭其他 Shotloom 页面后重试'));
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); opening = undefined; };
      resolve(request.result);
    };
  }).catch(error => { opening = undefined; throw error; });
  return opening;
}
export const scopeKey = scope => JSON.stringify([scope.userId, scope.projectKey]);
export async function readFiles(scope) {
  const db = await openDatabase(), owner = scopeKey(scope);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readonly');
    const request = tx.objectStore('files').index('owner').getAll(owner);
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
export async function commitFiles(scope, mutations) {
  const db = await openDatabase(), owner = scopeKey(scope);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite', { durability: 'strict' });
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Agent 本地存储失败'));
    const store = tx.objectStore('files');
    for (const { path, data } of mutations) {
      const key = JSON.stringify([owner, path]);
      if (data === null) store.delete(key); else store.put({ key, owner, path, data });
    }
  });
}
