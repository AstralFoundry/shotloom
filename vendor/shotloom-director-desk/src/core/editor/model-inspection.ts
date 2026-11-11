import * as T from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { boundsData, geometryBounds } from '../spatial/geometry.ts';
import { modelNodeHidden, setModelNodeHidden } from '../resources/model-node-visibility.ts';

export const MODEL_INSPECTION_VIEWS = ['front', 'back', 'left', 'right', 'top', 'three_quarter'] as const;
export type ModelInspectionView = (typeof MODEL_INSPECTION_VIEWS)[number];

const directions: Record<ModelInspectionView, T.Vector3> = {
    front: new T.Vector3(0, 0.15, 1),
    back: new T.Vector3(0, 0.15, -1),
    left: new T.Vector3(-1, 0.15, 0),
    right: new T.Vector3(1, 0.15, 0),
    top: new T.Vector3(0.001, 1, 0.001),
    three_quarter: new T.Vector3(0.8, 0.55, 1),
};

/** Clone the sampled scene object so studio capture cannot change the editor's model. */
export function inspectModel(root: T.Group, views: ModelInspectionView[]) {
    const model = cloneSkeleton(root) as T.Group;
    const preserveHiddenParts = (source: T.Object3D, target: T.Object3D) => {
        source.children.forEach((child, index) => {
            const copy = target.children[index];
            if (!copy) return;
            if (!child.visible || modelNodeHidden(child)) {
                copy.visible = false;
                setModelNodeHidden(copy, true);
            }
            preserveHiddenParts(child, copy);
        });
    };
    preserveHiddenParts(root, model);
    model.position.set(0, 0, 0);
    model.quaternion.identity();
    model.visible = true;
    const bounds = geometryBounds(model);
    if (!bounds || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite))
        throw new Error('模型没有可核验的有限几何边界');

    // A single wrapper group is common in imported models; inspect its children instead.
    let children: T.Object3D[] = model.children;
    let prefix = '0';
    while (children.length === 1 && children[0]!.type === 'Group' && children[0]!.children.length) {
        children = children[0]!.children;
        prefix += '/0';
    }
    const parts = children.slice(0, 48).flatMap((child, index) => {
        const box = geometryBounds(child);
        if (!box) return [];
        return [{
            path: `${prefix}/${index}`,
            name: child.name || `part_${index + 1}`,
            named: Boolean(child.name),
            ...boundsData(box),
        }];
    });
    const warnings: string[] = [];
    if (children.length > 48) warnings.push(`模型有 ${children.length} 个直接部件，仅返回前 48 个；请结合多视角图判断整体。`);
    if (parts.length > 1 && parts.every(part => !part.named))
        warnings.push('模型部件没有语义名称；尺寸可核对，但无法仅凭 part_N 判断各部件用途。');
    let meshes = 0;
    let triangles = 0;
    model.traverse(object => {
        if (!(object instanceof T.Mesh)) return;
        meshes += 1;
        const geometry = object.geometry;
        const vertices = geometry.getAttribute('position')?.count ?? 0;
        triangles += Math.floor((geometry.getIndex()?.count ?? vertices) / 3) * (object instanceof T.InstancedMesh ? object.count : 1);
    });
    return { model, box: bounds, bounds: boundsData(bounds), parts, partCount: children.length, meshes, triangles, warnings, views };
}

/** Neutral studio images reveal shape and relative layout; scene lighting is checked separately. */
export function captureModelViews(model: T.Group, bounds: T.Box3, views: ModelInspectionView[]) {
    const cell = 384;
    const gap = 6;
    const columns = Math.min(2, views.length);
    const rows = Math.ceil(views.length / columns);
    const sheet = document.createElement('canvas');
    sheet.width = columns * cell + (columns + 1) * gap;
    sheet.height = rows * cell + (rows + 1) * gap;
    const context = sheet.getContext('2d');
    if (!context) throw new Error('无法创建模型多视角拼图');
    context.fillStyle = '#292c31';
    context.fillRect(0, 0, sheet.width, sheet.height);
    const scene = new T.Scene();
    scene.background = new T.Color('#e5e7eb');
    scene.add(model);
    scene.add(new T.HemisphereLight(0xffffff, 0x88909c, 2));
    const sun = new T.DirectionalLight(0xffffff, 2);
    sun.position.set(3, 6, 5);
    scene.add(sun);
    const camera = new T.PerspectiveCamera(35, 1, 0.01, 10000);
    const center = bounds.getCenter(new T.Vector3());
    const radius = Math.max(bounds.getBoundingSphere(new T.Sphere()).radius, 0.1);
    const distance = radius / Math.sin(T.MathUtils.degToRad(17.5)) * 1.2;
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    try {
        renderer.setPixelRatio(1);
        renderer.setSize(cell, cell, false);
        renderer.outputColorSpace = T.SRGBColorSpace;
        for (const [index, view] of views.entries()) {
            camera.up.set(0, view === 'top' ? 0 : 1, view === 'top' ? -1 : 0);
            camera.position.copy(center).addScaledVector(directions[view].clone().normalize(), distance);
            camera.lookAt(center);
            renderer.render(scene, camera);
            const x = gap + index % columns * (cell + gap);
            const y = gap + Math.floor(index / columns) * (cell + gap);
            context.drawImage(renderer.domElement, x, y, cell, cell);
            context.font = '600 14px sans-serif';
            context.fillStyle = 'rgba(0, 0, 0, 0.78)';
            context.fillRect(x, y, Math.ceil(context.measureText(view).width) + 22, 26);
            context.fillStyle = '#fff';
            context.textBaseline = 'middle';
            context.fillText(view, x + 11, y + 13);
        }
        return { dataUrl: sheet.toDataURL('image/jpeg', 0.9), width: sheet.width, height: sheet.height,
            cells: views.map((view, index) => ({ view, row: Math.floor(index / columns), col: index % columns })) };
    } finally {
        renderer.dispose();
        renderer.forceContextLoss();
    }
}
