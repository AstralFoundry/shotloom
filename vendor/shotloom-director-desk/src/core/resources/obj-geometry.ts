import * as T from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { modelPath, unpackModelFiles, type ModelPackage } from './model-package.ts';
import { normalizedObjText, objLibraries, readObjMaterials } from './obj-source.ts';

export const objPackagePrefix = 'model-package:///';
export interface ObjMeshData {
    name: string;
    attributes: { name: string; array: Float32Array; itemSize: number; normalized: boolean }[];
    groups: { start: number; count: number; materialIndex?: number }[];
    materials: { name: string; flatShading: boolean; vertexColors: boolean }[];
    multiple: boolean;
}
export interface ObjGeometryData {
    meshes: ObjMeshData[];
    materialText: string;
    files: Map<string, Uint8Array>;
}

/** No DOM or texture decoding. The same parser runs in the browser worker and Node tests. */
export function parseObjGeometry(resource: ModelPackage): ObjGeometryData {
    const files = unpackModelFiles(resource),
        entry = modelPath(resource.entry),
        bytes = files.get(entry);
    if (!bytes) throw Error('未找到模型主文件：' + entry);
    const materialText = objLibraries(entry, bytes, files)
        .flatMap((library) =>
            readObjMaterials(library, files.get(library)!).flatMap((material) => [
                'newmtl ' + material.name,
                ...material.properties.map(
                    (p) =>
                        p.key +
                        ' ' +
                        (p.texture
                            ? p.texture.options +
                              ' ' +
                              objPackagePrefix +
                              p.texture.path.split('/').map(encodeURIComponent).join('/')
                            : p.value),
                ),
            ]),
        )
        .join('\n');
    const root = new OBJLoader().parse(normalizedObjText(bytes)),
        meshes: ObjMeshData[] = [];
    try {
        root.traverse((node) => {
            if (node instanceof T.Line || node instanceof T.Points)
                throw Error('当前 OBJ 需要面网格，请将线或点对象转换为网格后导出');
            if (!(node instanceof T.Mesh)) return;
            const materials = (Array.isArray(node.material) ? node.material : [node.material]) as T.MeshPhongMaterial[];
            meshes.push({
                name: node.name,
                attributes: Object.entries((node.geometry as T.BufferGeometry).attributes).map(([name, attribute]) => ({
                    name,
                    array: attribute.array as Float32Array,
                    itemSize: attribute.itemSize,
                    normalized: attribute.normalized,
                })),
                groups: node.geometry.groups,
                multiple: Array.isArray(node.material),
                materials: materials.map((m) => ({
                    name: m.name,
                    flatShading: m.flatShading,
                    vertexColors: m.vertexColors,
                })),
            });
        });
        // The OBJ text is no longer needed on the render thread. Keep dependencies for texture loading.
        files.delete(entry);
        return { meshes, materialText, files };
    } finally {
        root.traverse((node) => {
            if (node instanceof T.Mesh || node instanceof T.Line || node instanceof T.Points) {
                node.geometry.dispose();
                for (const material of Array.isArray(node.material) ? node.material : [node.material])
                    material.dispose();
            }
        });
    }
}
