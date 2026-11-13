import * as T from 'three';
import { entity, clip, type Action } from '../model.ts';
import { makeActor, animateActor } from '../assets/actors.ts';
import { disposeTree } from '../assets/dispose.ts';
import { actionDuration } from './action-timing.ts';

const cache = new Map<Action, string>();
let renderer: T.WebGLRenderer | undefined;
let queue: Promise<unknown> = Promise.resolve();

function paint(action: Action): string {
    if (!renderer) {
        renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setClearColor(0x000000, 0);
    }
    renderer.setSize(180, 150, false);
    renderer.setPixelRatio(1);
    const scene = new T.Scene();
    const model = entity('actor', 'human-adult', '预览');
    // Mid-grey reads on both the dark and the light tile backgrounds.
    model.color = '#85858e';
    model.clips = [clip(action, 0, actionDuration(action))];
    const rig = makeActor(model);
    try {
        scene.add(rig.root, new T.HemisphereLight('#ffffff', '#777777', 2.5));
        const light = new T.DirectionalLight('#ffffff', 2);
        light.position.set(3, 5, 4);
        scene.add(light);
        animateActor(rig, model, actionDuration(action) * 0.35);
        const camera = new T.PerspectiveCamera(35, 180 / 150, 0.01, 50);
        camera.position.set(2.7, 2.1, 4.2);
        camera.lookAt(0, 0.85, 0);
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL('image/webp', 0.82);
    } finally {
        disposeTree(rig.root);
        renderer.renderLists.dispose();
    }
}

export function actionThumbnail(action: Action, wanted: () => boolean): Promise<string | null> {
    const task = queue.then(async () => {
        if (!wanted()) return null;
        const cached = cache.get(action);
        if (cached) return cached;
        await new Promise<void>((resolve) => {
            if ('requestIdleCallback' in globalThis) requestIdleCallback(() => resolve(), { timeout: 300 });
            else requestAnimationFrame(() => resolve());
        });
        if (!wanted()) return null;
        const image = paint(action);
        cache.set(action, image);
        return image;
    });
    queue = task.catch(() => undefined);
    return task;
}
