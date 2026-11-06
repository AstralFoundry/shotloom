export const PROJECT_WORKSPACE_ROUTES = new Set(['creation', 'tasks', 'assets', 'materials']);
// skills 是应用级目录视图：不隶属工程，恢复路由时不要求存在已持久化的工程。
// skills 是应用级目录视图：不隶属工程，恢复路由时不要求存在已持久化的工程。
export const APPLICATION_ROUTES = new Set(['projects', 'skills', ...PROJECT_WORKSPACE_ROUTES]);

export function hasPersistedProject(projectState: any = {}) {
  return Boolean(
    projectState.projectDir
    && projectState.filePath
    && projectState.project?.schema === 'shotloom-project',
  );
}

export function resolveProjectRoute(route: string, projectState: any = {}) {
  if (!APPLICATION_ROUTES.has(route)) return 'projects';
  if (PROJECT_WORKSPACE_ROUTES.has(route) && !hasPersistedProject(projectState)) {
    return 'projects';
  }
  return route;
}
