import type { DirectorDeskSummary } from '../adapters/directorDeskBridge';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Read the card totals from the persisted active scene, without mounting the desk iframe. */
export function directorProjectSummary(document: unknown): DirectorDeskSummary | null {
  if (!record(document) || document.format !== 'director-desk' || document.version !== 3 || !Array.isArray(document.scenes)) return null;
  const active = document.scenes.find((scene) => record(scene) && scene.id === document.activeSceneId);
  if (!record(active) || !record(active.state)) return null;
  const { entities, cuts, duration } = active.state;
  if (!Array.isArray(entities) || !Array.isArray(cuts) || typeof duration !== 'number' || !Number.isFinite(duration)) return null;
  return {
    actors: entities.filter((entity) => record(entity) && (entity.kind === 'actor' || entity.kind === 'crowd')).length,
    cameras: entities.filter((entity) => record(entity) && entity.kind === 'camera').length,
    shots: Math.max(cuts.length, 1),
    duration,
  };
}
