import { Box3, Vector3 } from 'three';
import { entity } from '../model.ts';
import { makeActor } from './actors.ts';
import { makeProp } from './props.ts';
import { makeCrowd } from './crowd.ts';
import { disposeTree } from './dispose.ts';
import type { AssetDefinition } from './catalog/types.ts';

const sizes = new Map<string, { width: number; height: number; depth: number }>();
/** Use the same geometry factory as the viewport, including defaults not described by parameters. */
export function describeAsset(asset: AssetDefinition) {
    let defaultSize = sizes.get(asset.id);
    if (!defaultSize) {
        const e = entity(asset.kind, asset.id, asset.name);
        const root = asset.kind === 'actor' ? makeActor(e).root : asset.kind === 'crowd' ? makeCrowd(e).root : makeProp(e);
        try {
            root.updateMatrixWorld(true);
            const size = new Box3().setFromObject(root, true).getSize(new Vector3());
            defaultSize = { width: size.x, height: size.y, depth: size.z };
            sizes.set(asset.id, defaultSize);
        } finally { disposeTree(root); }
    }
    return {
        id: asset.id, name: asset.name, kind: asset.kind, group: asset.group,
        defaultSize, sizeMethod: 'default-geometry-bounds',
        params: Object.keys(asset.parameters ?? {}), parameters: asset.parameters ?? {},
        capabilities: asset.capabilities,
    };
}
