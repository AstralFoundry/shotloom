import { packModelFiles, type ModelSourceFile, type ModelPackage } from './model-package.ts';
import { parseObjGeometry } from './obj-geometry.ts';
import { modelPackageId } from './model-package-id.ts';

export type ModelWorkerRequest =
    | { operation: 'pack'; entry: string; files: ModelSourceFile[] }
    | { operation: 'obj' | 'hash'; resource: ModelPackage };
// One task per worker: terminating it also cancels synchronous parsing and releases its heap.
self.onmessage = async (event: MessageEvent<ModelWorkerRequest>) => {
    try {
        const request = event.data;
        if (request.operation === 'pack') {
            self.postMessage({ result: packModelFiles(request.entry, request.files) });
        } else if (request.operation === 'hash') {
            self.postMessage({ result: await modelPackageId(request.resource) });
        } else {
            const result = parseObjGeometry(request.resource);
            const buffers = new Set<ArrayBuffer>();
            for (const mesh of result.meshes)
                for (const a of mesh.attributes) buffers.add(a.array.buffer as ArrayBuffer);
            for (const file of result.files.values()) buffers.add(file.buffer as ArrayBuffer);
            self.postMessage({ result }, { transfer: [...buffers] });
        }
    } catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
};
