/** 浏览器预览的本地文件独立存入 IndexedDB，工程 JSON 只持有稳定引用。 */
const PREFIX = 'browser-file:';
let database: Promise<IDBDatabase> | undefined;

function openFiles(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open('shotloom-browser-files', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files');
      request.onerror = () => {
        database = undefined;
        reject(request.error);
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          database = undefined;
        };
        resolve(request.result);
      };
    });
  }
  return database;
}

export function isBrowserFile(path: string): boolean {
  return path.startsWith(PREFIX);
}

export async function saveBrowserFile(blob: Blob, name: string) {
  const db = await openFiles();
  const path = `${PREFIX}${crypto.randomUUID()}/${encodeURIComponent(name)}`;
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('files', 'readwrite');
    transaction.objectStore('files').put(blob, path);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  return { path, filePath: path, name, size: blob.size, mimeType: blob.type };
}

export async function readBrowserFile(path: string): Promise<ArrayBuffer> {
  const db = await openFiles();
  const blob = await new Promise<Blob>((resolve, reject) => {
    const request = db.transaction('files', 'readonly').objectStore('files').get(path);
    request.onsuccess = () =>
      request.result instanceof Blob ? resolve(request.result) : reject(new Error('Browser file is missing'));
    request.onerror = () => reject(request.error);
  });
  return blob.arrayBuffer();
}
