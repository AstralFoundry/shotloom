import * as T from 'three';
import { findAsset } from '../asset-catalog.ts';
import { entity } from '../model.ts';
import { makeActor } from './actors.ts';
import { makeProp } from './props.ts';
import { disposeTree } from './dispose.ts';
import { readLocalModel } from '../resources/local-model-library.ts';

const cache = new Map<string, string>();
const dimensions = new Map<string, [number, number, number]>();
export const assetDimensions = (id: string) => dimensions.get(id);
let renderer: T.WebGLRenderer | undefined,
    queue: Promise<unknown> = Promise.resolve();
function renderThumbnail(root: T.Group, showLights = false) {
    renderer ??= new T.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setSize(192, 132, false);
    renderer.setPixelRatio(1);
    const scene = new T.Scene();
    try {
        scene.add(root);
        scene.add(new T.HemisphereLight(0xffffff, 0x666666, 2));
        const sun = new T.DirectionalLight(0xffffff, 2);
        sun.position.set(3, 6, 5);
        scene.add(sun);
        const bounds = new T.Box3().setFromObject(root, true),
            center = bounds.getCenter(new T.Vector3()),
            radius = bounds.getBoundingSphere(new T.Sphere()).radius;
        const camera = new T.PerspectiveCamera(35, 192 / 132, Math.max(0.0001, radius / 1000), radius * 100 + 10);
        // Lights have no rendered surface; their editor markers live on layer 1.
        if (showLights) camera.layers.enable(1);
        camera.position
            .copy(center)
            .add(
                new T.Vector3(0.8, 0.55, 1)
                    .normalize()
                    .multiplyScalar((radius / Math.sin(T.MathUtils.degToRad(17.5))) * 1.03),
            );
        camera.lookAt(center);
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL('image/webp', 0.82);
    } finally {
        root.removeFromParent();
        renderer.renderLists.dispose();
    }
}
function paint(id: string, angle: number) {
    const definition = findAsset(id);
    if (!definition) throw new Error('资产不存在');
    const object = entity(definition.kind, id, definition.name), root = new T.Group();
    try {
        if (definition.kind === 'crowd')
            for (let index = 0; index < 3; index++) {
                const person = makeActor(object);
                person.root.position.set((index - 1) * 0.65, 0, (index % 2) * -0.22);
                root.add(person.root);
            }
        else root.add(definition.kind === 'actor' ? makeActor(object).root : makeProp(object));
        dimensions.set(id, new T.Box3().setFromObject(root).getSize(new T.Vector3()).toArray());
        root.rotation.y = angle;
        return renderThumbnail(root, Boolean(object.light));
    } finally {
        disposeTree(root);
    }
}
/** One renderer, a bounded cache, and at most one generation during an idle slice. */
function enqueueThumbnail(key: string, wanted: () => boolean, generate: () => string | null | Promise<string | null>) {
    const task = queue.then(async () => {
        if (!wanted()) return null;
        const existing = cache.get(key);
        if (existing) {
            cache.delete(key);
            cache.set(key, existing);
            return existing;
        }
        await new Promise<void>((resolve) => {
            if ('requestIdleCallback' in globalThis) requestIdleCallback(() => resolve(), { timeout: 500 });
            else requestAnimationFrame(() => resolve());
        });
        if (!wanted()) return null;
        const data = await generate();
        if (!data) return null;
        cache.set(key, data);
        if (cache.size > 96) cache.delete(cache.keys().next().value!);
        return data;
    });
    queue = task.catch(() => undefined);
    return task;
}

export function thumbnail(id: string, wanted: () => boolean, angle = 0): Promise<string | null> {
    return enqueueThumbnail(`${id}:${angle.toFixed(3)}`, wanted, () => paint(id, angle));
}

export function localModelThumbnail(id: string, wanted: () => boolean): Promise<string | null> {
    return enqueueThumbnail(`local:${id}`, wanted, async () => {
        const resource = await readLocalModel(id);
        if (!resource || !wanted()) return null;
        const { loadModelPackage } = await import('../resources/model-loader.ts');
        if (!wanted()) return null;
        const model = await loadModelPackage(resource.package);
        try {
            if (!wanted() || !model.inspection.meshes) return null;
            return renderThumbnail(model.instantiate().root);
        } finally {
            model.dispose();
        }
    });
}
