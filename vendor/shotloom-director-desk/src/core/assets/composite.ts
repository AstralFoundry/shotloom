import * as T from 'three';
import { entity, type Entity } from '../model.ts';
import { makeShape } from './shapes.ts';

/**
 * Build a composite prop out of primitive shapes.
 *
 * The catalogue covers walls, furniture and common set dressing, but not a campfire, a guitar or
 * whatever specific object a user names. The alternatives were worse: renaming a semantically
 * unrelated prop (the staging skill forbids that, and it reads wrong in any close shot), or letting
 * the model emit code. Declarative parts keep the result an ordinary editable entity — selectable,
 * undoable, stored in the project file, inspectable with `inspect_model` — and there is no code to
 * execute, sandbox or audit.
 *
 * Each part is a catalogue shape asset, so sizes, curves and segment counts come from the same
 * builders the catalogue uses; nothing here re-implements geometry.
 */
export function makeComposite(e: Entity) {
    const root = new T.Group();
    for (const part of e.parts ?? []) {
        // A throwaway entity per part: `makeShape` reads only the asset, colour and size parameters.
        const child = entity('prop', part.shape, part.shape);
        child.color = part.color ?? e.color;
        if (part.size) {
            child.assetParameters = { width: part.size[0], height: part.size[1], depth: part.size[2] };
        }
        const geometry = makeShape(child);
        geometry.position.set(part.at[0], part.at[1], part.at[2]);
        if (part.rotationDegrees) {
            const [x, y, z] = part.rotationDegrees;
            geometry.rotation.set(
                T.MathUtils.degToRad(x),
                T.MathUtils.degToRad(y),
                T.MathUtils.degToRad(z),
            );
        }
        root.add(geometry);
    }
    return root;
}
