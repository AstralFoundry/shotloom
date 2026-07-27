export const PROJECT_WORKSPACE_ROUTES = new Set(['creation', 'tasks', 'assets', 'materials']);
export const APPLICATION_ROUTES = new Set(['projects', ...PROJECT_WORKSPACE_ROUTES]);

export function hasPersistedProject(projectState = {}) {
  return Boolean(
    projectState.projectDir
    && projectState.filePath
    && projectState.project?.schema === 'shotloom-project',
  );
}

export function resolveProjectRoute(route, projectState = {}) {
  if (!APPLICATION_ROUTES.has(route)) return 'projects';
  if (PROJECT_WORKSPACE_ROUTES.has(route) && !hasPersistedProject(projectState)) {
    return 'projects';
  }
  return route;
}
