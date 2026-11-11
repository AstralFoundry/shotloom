import { packModelFiles, type ModelPackage, type ModelSourceFile } from './model-package.ts';
import { cloneModelPackage, rememberModelPackageEvidence } from './model-data.ts';
import type { ModelWorkerRequest } from './model-import.worker.ts';
import type { ObjGeometryData } from './obj-geometry.ts';
import { modelPackageId } from './model-package-id.ts';

function runWorker<T>(request: ModelWorkerRequest, transfer: Transferable[], signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./model-import.worker.ts', import.meta.url), { type: 'module' });
        const close = () => {
            signal?.removeEventListener('abort', abort);
            worker.terminate();
        };
        const abort = () => {
            close();
            reject(signal?.reason ?? new DOMException('已取消', 'AbortError'));
        };
        worker.onmessage = ({ data }) => {
            close();
            if (data.error) reject(Error(data.error));
            else resolve(data.result);
        };
        worker.onerror = (event) => {
            event.preventDefault();
            close();
            reject(Error(event.message || '模型后台读取失败'));
        };
        worker.onmessageerror = () => {
            close();
            reject(Error('模型后台数据传输失败'));
        };
        signal?.addEventListener('abort', abort, { once: true });
        try {
            worker.postMessage(request, transfer);
        } catch (error) {
            close();
            reject(error);
        }
    });
}

export async function modelResourceIdAsync(resource: ModelPackage, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    return typeof Worker === 'undefined'
        ? modelPackageId(resource)
        : runWorker<string>({ operation: 'hash', resource }, [], signal);
}

/** Takes ownership of these newly read buffers; never transfer buffers used by a live model. */
export async function packModelFilesAsync(
    entry: string,
    files: ModelSourceFile[],
    signal?: AbortSignal,
): Promise<ModelPackage> {
    signal?.throwIfAborted();
    const result =
        typeof Worker === 'undefined'
            ? packModelFiles(entry, files)
            : await runWorker<ModelPackage>(
                  { operation: 'pack', entry, files },
                  [...new Set(files.map((f) => f.bytes.buffer as ArrayBuffer))],
                  signal,
              );
    signal?.throwIfAborted();
    rememberModelPackageEvidence(result, cloneModelPackage(result, false));
    return result;
}

export async function readObjGeometry(resource: ModelPackage, signal?: AbortSignal): Promise<ObjGeometryData> {
    signal?.throwIfAborted();
    const snapshot = cloneModelPackage(resource, false);
    const result =
        typeof Worker === 'undefined'
            ? (await import('./obj-geometry.ts')).parseObjGeometry(snapshot)
            : await runWorker<ObjGeometryData>({ operation: 'obj', resource: snapshot }, [], signal);
    signal?.throwIfAborted();
    // Evidence applies only to the exact content validated by the worker; normal checks compare it.
    rememberModelPackageEvidence(resource, snapshot);
    return result;
}
