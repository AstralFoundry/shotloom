import * as T from 'three';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { modelPath, type ModelPackage } from './model-package.ts';
import { readObjGeometry } from './model-import-worker.ts';
import { objPackagePrefix as prefix } from './obj-geometry.ts';
import { adoptModel, disposeSource, type LoadedModel, type ModelSource } from './model-runtime.ts';

export async function loadObjModel(resource: ModelPackage, signal?: AbortSignal): Promise<LoadedModel> {
    signal?.throwIfAborted();
    const parsed = await readObjGeometry(resource, signal),
        files = parsed.files;
    const manager = new T.LoadingManager(),
        urls = new Map<string, string>();
    let failed = false;
    const ready = new Promise<void>((resolve) => {
        manager.onLoad = resolve;
    });
    manager.onError = () => {
        failed = true;
    };
    manager.setURLModifier((url) => {
        signal?.throwIfAborted();
        if (!url.startsWith(prefix)) throw Error('OBJ 尝试读取未打包的资源');
        const name = modelPath(decodeURIComponent(url.slice(prefix.length))),
            file = files.get(name);
        if (!file) throw Error('模型资源缺失：' + name);
        if (!urls.has(name)) urls.set(name, URL.createObjectURL(new Blob([new Uint8Array(file)])));
        return urls.get(name)!;
    });
    const materials = new MTLLoader(manager).parse(parsed.materialText, '');
    const source: ModelSource = { scene: new T.Group(), scenes: [], animations: [], cameras: [], textures: [] };
    // A later map can fail before its material is constructed. Track earlier textures independently.
    const loadTexture = materials.loadTexture.bind(materials);
    materials.loadTexture = (...args: Parameters<typeof loadTexture>) => {
        const texture = loadTexture(...args);
        source.textures!.push(texture);
        return texture;
    };
    let parseError: unknown;
    manager.itemStart('obj-parse');
    try {
        for (const mesh of parsed.meshes) {
            const geometry = new T.BufferGeometry();
            for (const a of mesh.attributes)
                geometry.setAttribute(a.name, new T.BufferAttribute(a.array, a.itemSize, a.normalized));
            for (const group of mesh.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
            // Attach first, so failures while loading materials also dispose this geometry.
            const node: T.Mesh = new T.Mesh(geometry, [] as T.Material[]);
            node.name = mesh.name;
            source.scene.add(node);
            const assigned: T.Material[] = [];
            node.material = assigned;
            for (const m of mesh.materials) assigned.push(materials.create(m.name) ?? new T.MeshPhongMaterial(m));
            if (!mesh.multiple) node.material = assigned[0];
        }
        source.scenes.push(source.scene);
    } catch (error) {
        parseError = error;
    } finally {
        manager.itemEnd('obj-parse');
    }
    try {
        // Geometry came from the worker; wait for renderer-owned textures before revoking URLs.
        await ready;
        source.materials = Object.values(materials.materials);
        if (parseError) throw parseError;
        source.scene.traverse((node) => {
            if (node instanceof T.Line || node instanceof T.Points)
                throw Error('当前 OBJ 需要面网格，请将线或点对象转换为网格后导出');
        });
        signal?.throwIfAborted();
        if (failed) throw Error('模型关联贴图无法解码，请检查图片文件');
    } catch (error) {
        disposeSource(source);
        throw error;
    } finally {
        urls.forEach((url) => URL.revokeObjectURL(url));
    }
    return adoptModel(source, '', [
        'OBJ 不记录可靠的单位与向上轴；请按实际尺寸校正。',
        'OBJ 按静态网格读取，不包含蒙皮或动画。',
    ]);
}
