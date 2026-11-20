import { cloudRequest } from './cloudRequest';
import { legacyProjectPage, type ProjectPage, type ProjectSummary } from '../../../shared/projectPages';
export async function readCloudProjectPage(query: URLSearchParams): Promise<ProjectPage> {
  try { return await cloudRequest<ProjectPage>(`/projects/page?${query}`, 'GET', undefined, {cacheMs: 5000}); }
  catch (error) {
    if (![404,405].includes((error as { status: number }).status)) throw error;
    return legacyProjectPage(await cloudRequest<ProjectSummary[]>('/projects'), query);
  }
}
export function projectSummaryEntry(project: ProjectSummary) {
  const projectDir = project.cloudFolderId ? `cloud/projects/folders/${project.cloudFolderId}/${project.id}` : `cloud/projects/${project.id}`;
  return { ...project, kind: 'project' as const, projectDir, filePath: `${projectDir}/project.sqlite` };
}
export async function loadCloudProjectLibrary() {
  const [folders, page] = await Promise.all([
    cloudRequest<Array<{ id: string; name: string; parentId: string | null }>>('/library-folders', 'GET', undefined, {cacheMs: 5000}), readCloudProjectPage(new URLSearchParams({ search: '', sort: 'updated', offset: '0', limit: '20' })),
  ]);
  const tree = (parent: string | null): Record<string, unknown>[] => folders.filter(folder => folder.parentId === parent).map(folder => ({ kind: 'folder', name: folder.name, folderDir: `cloud/projects/folders/${folder.id}`, children: tree(folder.id) }));
  return [...tree(null), ...page.items.map(projectSummaryEntry)];
}
