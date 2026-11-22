import { nanoid } from 'nanoid';
import {
    createPrevisActor, createPrevisCamera, createPrevisCatalogProp, createPrevisLayoutObject,
    createPrevisLight, createPrevisObject, PREVIS_ACTOR_ARCHETYPES, removePrevisKeyframe,
    touchPrevisScene, upsertPrevisKeyframe,
} from '@/lib/previs/previs-scene';
import { PREVIS_TEMPLATES, createPrevisSceneFromTemplate } from '@/lib/previs/previs-templates';
import { PREVIS_PROP_CATALOG, PREVIS_LAYOUT_TEMPLATES, resolvePrevisCatalogProp, resolvePrevisPropParams } from '@/lib/previs/previs-prop-catalog';
import { PREVIS_CAMERA_TECHNIQUES, PREVIS_CAMERA_RECIPES } from '@/lib/previs/previs-camera-techniques';
import { addPrevisCameraMoves, buildPrevisCameraRecipeMoves, createPrevisCameraMove, removePrevisCameraMove } from '@/lib/previs/previs-camera-moves';
import { applyPrevisMotionPath, isPrevisPathKeyframe, PREVIS_PATH_MAX_POINTS } from '@/lib/previs/previs-motion-path';
import { PREVIS_MOTION_IDS, previsMotionsOverlap } from '@/lib/previs/previs-motion';
import { applyPrevisActorTravel, PREVIS_TRAVEL_STYLES } from '@/lib/previs/previs-travel';
import { normalizePrevisWorld, PREVIS_DEFAULT_WORLD, PREVIS_GROUND_OPTIONS, PREVIS_GROUND_SIZES, PREVIS_WEATHER_OPTIONS } from '@/lib/previs/previs-world';
import { PREVIS_ASPECT_RATIOS } from '@/lib/previs/previs-optics';
import type { PrevisCamera, PrevisCameraMoveParams, PrevisObject, PrevisScene, PrevisShot, PrevisTransform, PrevisVec3 } from '@/types/previs';

type Row = Record<string, unknown>;
const sizes = ['extreme_wide', 'wide', 'full', 'medium', 'close_up', 'extreme_close_up'] as const;
const lights = ['directional', 'point', 'spot', 'ambient'] as const;
const easings = ['linear', 'ease_in', 'ease_out', 'smooth'] as const;

function row(value: unknown): Row {
    if (value === undefined) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
    return value as Row;
}
function text(value: unknown, name: string) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
    return value.trim();
}
function number(value: unknown, name: string, min = -Infinity, max = Infinity) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${name}: expected a finite value in [${min}, ${max}]`);
    return value;
}
function choose<T extends string | number>(value: unknown, values: readonly T[], name: string): T {
    const option = values.find(item => item === value);
    if (option === undefined) throw new Error(`Unknown ${name}: ${String(value)}`);
    return option;
}
function bool(value: unknown, name: string) {
    if (typeof value !== 'boolean') throw new Error(`Invalid ${name}: expected true or false`);
    return value;
}
function vector(value: unknown, name: string, minimum = -Infinity): PrevisVec3 {
    if (!Array.isArray(value) || value.length !== 3) throw new Error(`${name} must have exactly three coordinates`);
    return value.map(item => number(item, name, minimum)) as PrevisVec3;
}
function color(value: unknown) {
    if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) throw new Error('color must be #RRGGBB');
    return value;
}
function find<T extends { id: string }>(items: T[], value: unknown, label: string): T {
    const id = text(value, label);
    const found = items.find(item => item.id === id);
    if (!found) throw new Error(`${label} ${id} does not exist in this scene`);
    return found;
}
function replace<T extends { id: string }>(items: T[], item: T) {
    return items.map(entry => entry.id === item.id ? item : entry);
}
function actor(scene: PrevisScene, id: unknown) {
    const object = find(scene.objects, id, 'actor ID');
    if (object.kind !== 'actor' && object.primitive !== 'character') throw new Error(`${object.id} is not an actor`);
    return object;
}
function transform(base: PrevisTransform, props: Row, locked = false): PrevisTransform {
    const position = props.position === undefined ? [...base.position] as PrevisVec3 : vector(props.position, 'position');
    if (locked) position[1] = 0;
    return {
        position,
        rotation: props.rotation === undefined ? base.rotation : vector(props.rotation, 'rotation'),
        scale: props.scale === undefined ? base.scale : vector(props.scale, 'scale', .001),
    };
}
function timed(props: Row, shot: PrevisShot) {
    const start = number(props.start ?? 0, 'start', 0, shot.duration);
    return { start, duration: number(props.duration ?? shot.duration - start, 'duration', .1, shot.duration - start) };
}
function selectedShot(scene: PrevisScene, id?: unknown) {
    return find(scene.shots, id ?? scene.activeShotId, 'shot ID');
}

export function previsAgentCatalog() {
    return {
        templates: PREVIS_TEMPLATES.map(({ id, name }) => ({ id, name })),
        props: PREVIS_PROP_CATALOG.map(({ id, name, params }) => ({ id, name, params })),
        layouts: PREVIS_LAYOUT_TEMPLATES, archetypes: PREVIS_ACTOR_ARCHETYPES, motions: PREVIS_MOTION_IDS,
        travelStyles: PREVIS_TRAVEL_STYLES.map(({ value }) => value),
        cameraTechniques: PREVIS_CAMERA_TECHNIQUES, cameraRecipes: PREVIS_CAMERA_RECIPES.map(({ id, label, hint, subject }) => ({ id, label, hint, subject })),
        weather: PREVIS_WEATHER_OPTIONS.map(({ value }) => value), ground: PREVIS_GROUND_OPTIONS.map(({ value }) => value),
        shotSizes: sizes, aspectRatios: PREVIS_ASPECT_RATIOS.map(({ value }) => value),
    };
}

export function createAgentPrevisScene(title: string, template: unknown) {
    return createPrevisSceneFromTemplate(choose(template ?? 'empty', PREVIS_TEMPLATES.map(item => item.id), 'template'), text(title, 'title'));
}

function applyOperation(scene: PrevisScene, op: Row) {
    const fields = row(op.fields);
    const id = op.id;
    switch (op.type) {
        case 'scene_update':
            if (fields.title !== undefined) scene.title = text(fields.title, 'title');
            if (fields.background !== undefined) scene.background = color(fields.background);
            if (fields.environmentIntensity !== undefined) scene.environmentIntensity = number(fields.environmentIntensity, 'environmentIntensity', 0, 10);
            if (fields.gridVisible !== undefined) scene.gridVisible = bool(fields.gridVisible, 'gridVisible');
            return scene.id;
        case 'world_update': {
            const world = { ...PREVIS_DEFAULT_WORLD, ...scene.world };
            if (fields.weather !== undefined) world.weather = choose(fields.weather, PREVIS_WEATHER_OPTIONS.map(item => item.value), 'weather');
            if (fields.ground !== undefined) world.ground = choose(fields.ground, PREVIS_GROUND_OPTIONS.map(item => item.value), 'ground');
            if (fields.groundSize !== undefined) world.groundSize = choose(fields.groundSize, PREVIS_GROUND_SIZES.map(item => item.value), 'groundSize');
            if (fields.timeOfDay !== undefined) world.timeOfDay = number(fields.timeOfDay, 'timeOfDay', 0, 24);
            if (fields.horizon !== undefined) world.horizon = bool(fields.horizon, 'horizon');
            scene.world = normalizePrevisWorld(world)!;
            return scene.id;
        }
        case 'object_add': {
            const name = text(fields.name, 'name');
            let object: PrevisObject;
            if (fields.kind === 'actor') {
                object = createPrevisActor(name, undefined, undefined, choose(fields.archetype ?? 'adult', PREVIS_ACTOR_ARCHETYPES.map(item => item.value), 'archetype'));
            } else if (fields.kind === 'prop') {
                const prop = resolvePrevisCatalogProp(text(fields.propId, 'propId'));
                if (!prop) throw new Error('Unknown propId; read the prop catalog');
                object = createPrevisCatalogProp({ name, propId: prop.id, color: color(fields.color ?? '#8795a5'), params: propParams(fields.params) });
            } else if (fields.kind === 'layout') {
                const template = PREVIS_LAYOUT_TEMPLATES.find(item => item.id === fields.template);
                if (!template) throw new Error('Unknown layout template');
                object = createPrevisLayoutObject({ name, layout: {
                    template: template.id, size: number(fields.size ?? template.defaultSize, 'size', template.minSize, template.maxSize),
                    density: number(fields.density ?? .65, 'density', .2, 1), seed: Math.trunc(number(fields.seed ?? 1, 'seed', 0, 2147483647)),
                    crowd: fields.crowd === undefined ? false : bool(fields.crowd, 'crowd'),
                } });
            } else {
                choose(fields.kind ?? 'primitive', ['primitive'], 'object kind');
                object = createPrevisObject(choose(fields.primitive ?? 'box', ['box', 'sphere', 'cylinder', 'plane'] as const, 'primitive'), name);
            }
            scene.objects.push(patchObject(object, fields));
            return object.id;
        }
        case 'object_update': {
            const item = find(scene.objects, id, 'object ID');
            scene.objects = replace(scene.objects, patchObject(item, fields));
            return item.id;
        }
        case 'object_remove': {
            const item = find(scene.objects, id, 'object ID');
            scene.objects = scene.objects.filter(object => object.id !== item.id);
            scene.cameras = scene.cameras.map(camera => ({ ...camera, moves: camera.moves?.filter(move => move.subjectId !== item.id) }));
            return item.id;
        }
        case 'camera_add':
        case 'camera_update': {
            const camera = op.type === 'camera_add' ? createPrevisCamera(text(fields.name, 'name')) : find(scene.cameras, id, 'camera ID');
            const next = { ...camera, transform: transform(camera.transform, fields) };
            if (fields.name !== undefined) next.name = text(fields.name, 'name');
            if (fields.target !== undefined) next.target = vector(fields.target, 'target');
            for (const key of ['focalLength', 'aperture', 'focusDistance'] as const) {
                if (fields[key] !== undefined) next[key] = number(fields[key], key, .01);
            }
            if (op.type === 'camera_add') scene.cameras.push(next);
            else scene.cameras = replace(scene.cameras, next);
            return next.id;
        }
        case 'camera_remove': {
            const camera = find(scene.cameras, id, 'camera ID');
            if (scene.shots.some(shot => shot.cameraId === camera.id) || scene.cameras.length <= 1) throw new Error('Assign the shots to another camera before removing this camera');
            scene.cameras = scene.cameras.filter(item => item.id !== camera.id);
            return camera.id;
        }
        case 'light_add':
        case 'light_update': {
            const light = op.type === 'light_add' ? createPrevisLight(choose(fields.lightType ?? 'directional', lights, 'lightType'),
                text(fields.name, 'name'), [0, 4, 0]) : find(scene.lights, id, 'light ID');
            const next = { ...light, transform: transform(light.transform, fields) };
            if (fields.name !== undefined) next.name = text(fields.name, 'name');
            if (fields.lightType !== undefined) next.type = choose(fields.lightType, lights, 'lightType');
            if (fields.color !== undefined) next.color = color(fields.color);
            if (fields.intensity !== undefined) next.intensity = number(fields.intensity, 'intensity', 0);
            if (fields.castShadow !== undefined) next.castShadow = bool(fields.castShadow, 'castShadow');
            if (op.type === 'light_add') scene.lights.push(next);
            else scene.lights = replace(scene.lights, next);
            return next.id;
        }
        case 'light_remove': {
            const light = find(scene.lights, id, 'light ID');
            scene.lights = scene.lights.filter(item => item.id !== light.id);
            return light.id;
        }
        case 'shot_add':
        case 'shot_update': {
            const shot = op.type === 'shot_add'
                ? { ...selectedShot(scene), id: nanoid(), name: text(fields.name, 'name'), prompt: '', previewNodeId: undefined, depthNodeId: undefined, normalNodeId: undefined }
                : find(scene.shots, id, 'shot ID');
            const next = { ...shot };
            if (fields.name !== undefined) next.name = text(fields.name, 'name');
            if (fields.cameraId !== undefined) next.cameraId = find(scene.cameras, fields.cameraId, 'camera ID').id;
            if (fields.duration !== undefined) next.duration = number(fields.duration, 'duration', .1, 120);
            if (fields.fps !== undefined) next.fps = choose(fields.fps, [24, 25, 30], 'fps');
            if (fields.shotSize !== undefined) next.shotSize = choose(fields.shotSize, sizes, 'shotSize');
            if (fields.aspectRatio !== undefined) next.aspectRatio = choose(fields.aspectRatio, PREVIS_ASPECT_RATIOS.map(item => item.value), 'aspectRatio');
            if (typeof fields.prompt === 'string') next.prompt = fields.prompt;
            if (op.type === 'shot_add') scene.shots.push(next);
            else scene.shots = replace(scene.shots, next);
            return next.id;
        }
        case 'shot_activate':
            scene.activeShotId = find(scene.shots, id, 'shot ID').id;
            return scene.activeShotId;
        case 'shot_remove': {
            const shot = find(scene.shots, id, 'shot ID');
            if (scene.shots.length <= 1) throw new Error('The scene requires at least one shot');
            scene.shots = scene.shots.filter(item => item.id !== shot.id);
            if (scene.activeShotId === shot.id) scene.activeShotId = scene.shots[0]!.id;
            return shot.id;
        }
        case 'actor_travel': {
            const object = actor(scene, id);
            const timing = timed(fields, selectedShot(scene, fields.shotId));
            const updated = applyPrevisActorTravel(object, { ...timing, to: vector(fields.to, 'to'),
                style: choose(fields.style ?? 'walk', PREVIS_TRAVEL_STYLES.map(item => item.value), 'travel style'),
                ...(fields.from !== undefined && { from: vector(fields.from, 'from') }),
                ...(fields.height !== undefined && { height: number(fields.height, 'height', 0) }) });
            scene.objects = replace(scene.objects, updated);
            return object.id;
        }
        case 'actor_motion_add': {
            const object = actor(scene, id);
            const motion = { id: nanoid(), motion: choose(fields.motion, PREVIS_MOTION_IDS, 'motion'),
                ...timed(fields, selectedShot(scene, fields.shotId)), intensity: number(fields.intensity ?? 1, 'intensity', 0, 2) };
            if (previsMotionsOverlap(object.motions || [], motion)) throw new Error('Motion overlaps an existing action of the same type');
            scene.objects = replace(scene.objects, { ...object, motions: [...(object.motions || []), motion].sort((a, b) => a.start - b.start) });
            return motion.id;
        }
        case 'actor_motion_remove': {
            const object = actor(scene, id);
            const motion = find(object.motions || [], fields.motionId, 'motion ID');
            scene.objects = replace(scene.objects, { ...object, motions: object.motions!.filter(item => item.id !== motion.id) });
            return motion.id;
        }
        case 'object_motion_path_set':
        case 'object_motion_path_clear':
        case 'keyframe_upsert':
        case 'keyframe_remove':
            return patchTrack(scene, op.type, id, fields);
        case 'camera_move':
        case 'camera_move_remove':
            return patchCameraMove(scene, op.type, id, fields);
        default:
            throw new Error(`Unsupported operation: ${String(op.type)}`);
    }
}

function propParams(value: unknown) {
    return Object.fromEntries(Object.entries(row(value)).map(([key, item]) => [key,
        typeof item === 'string' ? item : number(item, key)]));
}
function patchObject(item: PrevisObject, fields: Row): PrevisObject {
    const next = { ...item, transform: transform(item.transform, fields, item.kind === 'actor' || item.primitive === 'character') };
    if (fields.name !== undefined) next.name = text(fields.name, 'name');
    if (fields.color !== undefined) next.color = color(fields.color);
    if (fields.visible !== undefined) next.visible = bool(fields.visible, 'visible');
    if (next.kind === 'prop' && fields.params !== undefined) next.params = resolvePrevisPropParams(next.propId, { ...next.params, ...propParams(fields.params) });
    return next;
}

function patchTrack(scene: PrevisScene, type: string, id: unknown, fields: Row) {
    const camera = scene.cameras.find(item => item.id === id);
    const object = camera ?? find(scene.objects, id, 'object or camera ID');
    const locked = 'kind' in object && (object.kind === 'actor' || object.primitive === 'character');
    let next = { ...object };
    if (type === 'object_motion_path_set') {
        const source = fields.pathId !== undefined
            ? (scene.paths ?? []).find(item => item.id === fields.pathId || item.label === fields.pathId)?.points
            : fields.points;
        if (!Array.isArray(source) || source.length < 2 || source.length > PREVIS_PATH_MAX_POINTS) throw new Error('Use a valid reference path or supply 2–64 points');
        const points = source.map(point => vector(point, 'path point'));
        const shot = selectedShot(scene, fields.shotId);
        const startDelay = number(fields.startDelay ?? 0, 'startDelay', 0, shot.duration);
        next = applyPrevisMotionPath(next, { points, speed: choose(fields.speed ?? 'walk', ['slow', 'walk', 'run'], 'speed'),
            startDelay, orientToPath: fields.orientToPath === undefined ? locked : bool(fields.orientToPath, 'orientToPath'),
            easing: choose(fields.easing ?? 'smooth', easings, 'easing'), curve: fields.curve === undefined ? points.length > 2 : bool(fields.curve, 'curve'),
            ...(fields.metersPerSecond !== undefined && { metersPerSecond: number(fields.metersPerSecond, 'metersPerSecond', .05) }),
            ...(fields.duration !== undefined && { duration: number(fields.duration, 'duration', .1, shot.duration - startDelay) }),
        }, shot.duration, locked);
    } else if (type === 'object_motion_path_clear') {
        delete next.motionPath;
        next.keyframes = next.keyframes.filter(item => !isPrevisPathKeyframe(item, object.id));
    } else if (type === 'keyframe_upsert') {
        next.keyframes = upsertPrevisKeyframe(next.keyframes, number(fields.time, 'time', 0, selectedShot(scene, fields.shotId).duration),
            transform(next.transform, fields, locked));
    } else {
        const keyframe = find(next.keyframes, fields.keyframeId, 'keyframe ID');
        next.keyframes = removePrevisKeyframe(next.keyframes, keyframe.id);
    }
    if (camera) scene.cameras = replace(scene.cameras, next as PrevisCamera);
    else scene.objects = replace(scene.objects, next as PrevisObject);
    return object.id;
}

function patchCameraMove(scene: PrevisScene, type: string, id: unknown, fields: Row) {
    const camera = find(scene.cameras, id, 'camera ID');
    if (type === 'camera_move_remove') {
        const move = find(camera.moves || [], fields.moveId, 'move ID');
        scene.cameras = replace(scene.cameras, removePrevisCameraMove(camera, move.id));
        return move.id;
    }
    const shot = selectedShot(scene, fields.shotId);
    if (shot.cameraId !== camera.id) throw new Error('Use the camera assigned to the selected shot');
    const timing = timed(fields, shot);
    const subjectId = fields.subjectId === undefined ? undefined : find(scene.objects, fields.subjectId, 'subject ID').id;
    const scopedSubject = subjectId ? { subjectId } : {};
    let moves;
    if (fields.recipe !== undefined) {
        const recipe = PREVIS_CAMERA_RECIPES.find(item => item.id === fields.recipe);
        if (!recipe || (recipe.subject === 'required' && !subjectId)) throw new Error('Unknown recipe or missing required subjectId');
        moves = buildPrevisCameraRecipeMoves(recipe, { ...timing, ...scopedSubject, shotDuration: shot.duration });
    } else {
        const technique = PREVIS_CAMERA_TECHNIQUES.find(item => item.id === fields.technique);
        if (!technique || (technique.subject === 'required' && !subjectId)) throw new Error('Unknown technique or missing required subjectId');
        moves = [createPrevisCameraMove({ ...timing, ...scopedSubject, technique: technique.id,
            easing: choose(fields.easing ?? 'smooth', easings, 'easing'), params: row(fields.params) as PrevisCameraMoveParams,
        }, shot.duration)];
    }
    const result = addPrevisCameraMoves(camera, moves);
    if (!result) throw new Error('The camera cannot hold any more move segments');
    scene.cameras = replace(scene.cameras, result);
    return moves.map(move => move.id);
}

export function applyAgentPrevisPatch(current: PrevisScene, operations: unknown[]) {
    if (!operations.length) throw new Error('Provide at least one operation');
    const next = structuredClone(current);
    const results = operations.map((operation, index) => {
        const op = row(operation);
        try { return { type: op.type, ids: [applyOperation(next, op)].flat() }; }
        catch (cause) { throw new Error(`Operation ${index + 1} (${String(op.type)}): ${cause instanceof Error ? cause.message : String(cause)}`); }
    });
    return { scene: touchPrevisScene(next), results };
}
