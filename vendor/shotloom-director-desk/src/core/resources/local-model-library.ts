import type { ModelResource } from './project-resources.ts';

export type LocalModel = { id: string; name: string; credit: string; category?: string };
const databaseName = 'shotloom-director-local-models';
const changes = new EventTarget();

export function subscribeLocalModels(listener: () => void) {
    changes.addEventListener('change', listener);
    return () => changes.removeEventListener('change', listener);
}

function openDatabase() {
    return new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore('models');
            request.result.createObjectStore('catalog');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function read<Value>(store: string, select: (source: IDBObjectStore) => IDBRequest<Value>): Promise<Value> {
    const database = await openDatabase();
    try {
        return await new Promise<Value>((resolve, reject) => {
            const request = select(database.transaction(store).objectStore(store));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } finally {
        database.close();
    }
}

export function listLocalModels(): Promise<LocalModel[]> {
    return read('catalog', store => store.getAll());
}

export function readLocalModel(id: string): Promise<ModelResource | undefined> {
    return read('models', store => store.get(id));
}

export function readLocalModelInfo(id: string): Promise<LocalModel | undefined> {
    return read('catalog', store => store.get(id));
}

export async function updateLocalModelCategory(id: string, category: string) {
    const database = await openDatabase();
    try {
        const updated = await new Promise<boolean>((resolve, reject) => {
            const transaction = database.transaction('catalog', 'readwrite');
            const store = transaction.objectStore('catalog');
            const request = store.get(id);
            let changed = false;
            request.onsuccess = () => {
                const current = request.result as LocalModel | undefined;
                if (!current || current.category === category) return;
                store.put({ ...current, category }, id);
                changed = true;
            };
            transaction.oncomplete = () => resolve(changed);
            transaction.onabort = () => reject(transaction.error ?? Error('本地模型保存失败'));
        });
        if (updated) changes.dispatchEvent(new Event('change'));
    } finally {
        database.close();
    }
}

export async function saveLocalModel(id: string, resource: ModelResource, category?: string) {
    const database = await openDatabase();
    try {
        await new Promise<void>((resolve, reject) => {
            const transaction = database.transaction(['models', 'catalog'], 'readwrite');
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(transaction.error ?? Error('本地模型保存失败'));
            transaction.objectStore('models').put(resource, id);
            transaction.objectStore('catalog').put({ id, name: resource.name, credit: resource.copyright, category } satisfies LocalModel, id);
        });
        changes.dispatchEvent(new Event('change'));
    } finally {
        database.close();
    }
}
