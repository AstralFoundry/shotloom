/** 项目中的节点产物只有一套枚举、标识和选择规则；这里不保存第二份项目状态。 */
type MediaRecord = Record<string, any>;
type MediaProject = { nodes?: MediaRecord[] | undefined; materials?: MediaRecord[] | undefined };

export function createNodeMediaCatalog(project?: MediaProject | null) {
  const related = new Map<string, MediaRecord[]>();
  const append = (nodeId: string, output: MediaRecord) => {
    if (!nodeId) return;
    const items = related.get(nodeId) || [];
    items.push(output);
    related.set(nodeId, items);
  };
  for (const material of project?.materials || []) {
    append(String(material.nodeId || ''), {
      ...material,
      id: `material:${material.id}`,
      materialId: material.id,
      title: material.name,
      fileName: material.name,
      filePath: material.filePath || material.path,
    });
  }
  for (const node of project?.nodes || []) {
    if (node.type === 'resource' && !node.archived && node.generatedFrom?.nodeId) {
      append(String(node.generatedFrom.nodeId), node);
    }
  }
  function outputs(node: MediaRecord): MediaRecord[] {
    const seen = new Set<string>();
    return [
      ...(Array.isArray(node.generatedOutputs) ? node.generatedOutputs : []),
      ...(related.get(String(node.id || '')) || []),
    ].filter((item): item is MediaRecord => {
      if (!item || typeof item !== 'object') return false;
      const key = String(item.id || item.filePath || item.path || item.url || item.previewUrl || '');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function selected(node: MediaRecord): MediaRecord {
    const items = outputs(node);
    const selectedId = String(node.selectedOutputNodeId || '');
    return items.find((item) => String(item.id) === selectedId)
      || items.find((item) => item.selected)
      || items.at(-1)
      || node.uploadedFile
      || node;
  }
  return { outputs, selected };
}

export function selectedNodeMedia(node: MediaRecord | null | undefined, project?: MediaProject | null): MediaRecord | null {
  return node ? createNodeMediaCatalog(project).selected(node) : null;
}

export function localMediaPath(media: MediaRecord | null | undefined): string {
  const path = String(media?.filePath || media?.path || '');
  return /^(?:https?:|blob:|data:)/i.test(path) ? '' : path;
}
