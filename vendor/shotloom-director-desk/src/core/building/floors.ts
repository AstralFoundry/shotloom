import type { Entity } from '../model.ts';
/** The lite editor has one working plane; hidden objects are simply not visible. */
export const workingElevation = (_project: unknown) => 0;
export const editorEntityVisible = (_project: unknown, entity: Entity) => entity.visible;
