type RecordValue = Record<string, unknown>;
type DirectorEntry = { id: string; label: string; type: string; mediaType: 'other'; referenceScope: 'director-entity' | 'director-asset'; artifactType: string };

const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' ? value : '';
const part = (value: string) => encodeURIComponent(value);

export function directorReferenceCatalog(snapshot: unknown, catalog: unknown): DirectorEntry[] {
  if (!record(snapshot) || !record(snapshot.document)) return [];
  const document = snapshot.document;
  const projectId = text(document.projectId);
  const sceneId = text(document.activeSceneId);
  const scene = Array.isArray(document.scenes) ? document.scenes.find(item => record(item) && item.id === sceneId) : null;
  const state = record(scene) && record(scene.state) ? scene.state : null;
  const entities = Array.isArray(state?.entities) ? state.entities : [];
  const resources = Array.isArray(document.resources) ? document.resources : [];
  const assets = record(catalog) && Array.isArray(catalog.assets) ? catalog.assets : [];
  return [
    ...entities.filter(record).filter(entity => text(entity.id)).map(entity => ({
      id: `director:entity:${part(projectId)}:${part(sceneId)}:${part(text(entity.id))}`,
      label: text(entity.name) || text(entity.id), type: text(entity.kind), mediaType: 'other' as const,
      referenceScope: 'director-entity' as const, artifactType: text(entity.kind),
    })),
    ...resources.filter(record).filter(resource => text(resource.id)).map(resource => ({
      id: `director:resource:${part(projectId)}:${part(text(resource.id))}`,
      label: text(resource.name) || text(resource.id), type: 'model', mediaType: 'other' as const,
      referenceScope: 'director-asset' as const, artifactType: 'model',
    })),
    ...assets.filter(record).filter(asset => text(asset.id)).map(asset => ({
      id: `director:asset:${part(text(asset.id))}`,
      label: text(asset.name) || text(asset.id), type: text(asset.kind), mediaType: 'other' as const,
      referenceScope: 'director-asset' as const, artifactType: text(asset.kind),
    })),
  ];
}

export function resolveDirectorReference(id: string, snapshot: unknown, catalog: unknown) {
  const parts = id.split(':');
  if (parts[0] !== 'director' || !record(snapshot) || !record(snapshot.document)) throw new Error('当前导演台场景不可用');
  const document = snapshot.document;
  const entries = directorReferenceCatalog(snapshot, catalog);
  const node = entries.find(item => item.id === id);
  if (!node) throw new Error('导演台引用已失效，请重新选择当前场景中的对象');
  if (parts[1] === 'entity') {
    const scene = Array.isArray(document.scenes) ? document.scenes.find(item => record(item) && item.id === document.activeSceneId) : null;
    const state = record(scene) && record(scene.state) ? scene.state : null;
    const entity = Array.isArray(state?.entities) ? state.entities.find(item => record(item) && item.id === decodeURIComponent(parts[4] || '')) : null;
    return { node, snapshot: { source: 'director-scene', projectId: document.projectId, sceneId: document.activeSceneId, sceneName: record(scene) ? scene.name : '', entity }, images: [] };
  }
  if (parts[1] === 'resource') {
    const resource = Array.isArray(document.resources) ? document.resources.find(item => record(item) && `director:resource:${part(text(document.projectId))}:${part(text(item.id))}` === id) : null;
    if (!record(resource)) throw new Error('导演台模型资源已失效，请重新选择');
    const { id: resourceId, name, copyright, license, source } = resource;
    return { node, snapshot: { source: 'director-model-resource', projectId: document.projectId, resource: { id: resourceId, name, copyright, license, source } }, images: [] };
  }
  const asset = record(catalog) && Array.isArray(catalog.assets) ? catalog.assets.find(item => record(item) && item.id === decodeURIComponent(parts[2] || '')) : null;
  return { node, snapshot: { source: 'director-asset', asset }, images: [] };
}
