import { findAsset } from '@/core/asset-catalog.ts';
import type { Entity } from '@/core/model.ts';
import type { InspectorTab } from './editor-store.ts';

/** Only show controls that can edit the selected object. */
export function inspectorTabsFor(entity?: Entity): InspectorTab[] {
    // The scene itself offers the environment and the range check; both operate on the whole
    // project rather than on one selection.
    if (!entity) return ['environment', 'spatial'];

    const capabilities = findAsset(entity.asset)?.capabilities;
    const tabs: InspectorTab[] = ['base'];
    if ((capabilities?.path !== false && !entity.handBinding) || entity.path) tabs.push('path');
    if (
        (entity.kind === 'actor' || entity.kind === 'crowd') &&
        (capabilities?.actions.length !== 0 || entity.clips.length > 0)
    )
        tabs.push('actions');
    if (
        (entity.kind === 'actor' || entity.kind === 'crowd') &&
        !entity.external &&
        (capabilities?.pose !== false || entity.poseKeys.length > 0)
    )
        tabs.push('pose');
    if (entity.camera) tabs.push('camera');
    if (entity.light) tabs.push('light');
    // Keyframe editing applies to anything that can move, plus cameras with focal keys.
    if (entity.locked !== undefined) tabs.push('keys');
    return tabs;
}
