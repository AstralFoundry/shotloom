export type ProjectSummary = { id: string; name: string; storageRevision?: number; cloudFolderId?: string | null; createdAt?: string; updatedAt?: string; coverSource?: string };
export type ProjectPage = { items: ProjectSummary[]; total: number; offset: number; limit: number };
export function legacyProjectPage(projects: ProjectSummary[], query: URLSearchParams): ProjectPage {
  const search = (query.get('search') || '').toLowerCase(), sort = query.get('sort') || 'updated';
  const offset = Number(query.get('offset') || 0), limit = Number(query.get('limit') || 20);
  const items = projects.filter(project => (project.cloudFolderId || '') === (query.get('folder') || '') && project.name.toLowerCase().includes(search)).sort((a,b) => {
    const order = sort === 'name' ? a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      : Date.parse((sort === 'created' ? b.createdAt : b.updatedAt) || '') - Date.parse((sort === 'created' ? a.createdAt : a.updatedAt) || '');
    return order || a.id.localeCompare(b.id);
  });
  return { items: items.slice(offset, offset + limit), total: items.length, offset, limit };
}
