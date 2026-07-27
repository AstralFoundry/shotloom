export const PROJECT_SESSION_KEY = 'shotloom-session';

function persistedProjectIdentity(project = {}) {
  return {
    id: project.id,
    schema: project.schema,
    name: project.name,
    library: project.library,
    series: project.series,
    settings: project.settings,
    canvasViewport: project.canvasViewport,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

/**
 * 已落盘项目只在 WebView 存储中保留启动所需的身份信息。项目文件才是完整
 * 数据的唯一真值，避免节点、生成结果和历史快照重复占满 localStorage。
 */
export function buildProjectSession({ project, projectDir, filePath }) {
  const persisted = Boolean(projectDir && filePath);
  return {
    version: 2,
    snapshotKind: persisted ? 'identity' : 'full',
    project: persisted ? persistedProjectIdentity(project) : project,
    projectDir: projectDir || null,
    filePath: filePath || null,
  };
}

export function hasFullProjectSessionSnapshot(session) {
  if (!session?.project) return false;
  if (session.snapshotKind) return session.snapshotKind === 'full';
  // v1 会话没有 snapshotKind，历史完整快照都有这些数组。
  return Array.isArray(session.project.nodes) && Array.isArray(session.project.edges);
}
