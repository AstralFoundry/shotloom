import { uid } from '@/utils/format';

type MutableProject = Record<string, any>;
type AgentEvaluation = Record<string, any>;
type EvaluationCheck = { id: string; label: string; passed: boolean };

function ensureAgentEvaluations(project: MutableProject): AgentEvaluation[] {
  if (!Array.isArray(project.agentEvaluations)) project.agentEvaluations = [];
  return project.agentEvaluations;
}

function evaluationChecks(task: Record<string, any>, node: Record<string, any>): EvaluationCheck[] {
  const hasText = Boolean(
    String(task.result?.text || node?.textContent || '').trim()
    || node?.textOutputs?.some((value: unknown) => String(value || '').trim())
    || node?.storyboardCells?.length
  );
  const hasArchivedMedia = Boolean(task.result?.archivedFiles?.length);
  const hasOutput = node?.type === 'textGeneration' ? hasText : hasArchivedMedia;
  return [
    { id: 'task-completed', label: '任务完成', passed: task.status === 'completed' },
    { id: 'has-output', label: '存在有效输出', passed: hasOutput },
    { id: 'archive-valid', label: '结果归档无错误', passed: !task.result?.archiveError },
  ];
}

function summaryFromTask(task: Record<string, any>, checks: EvaluationCheck[], node: Record<string, any>): string {
  if (task.result?.archiveError) return `生成完成，但归档存在问题：${task.result.archiveError}`;
  if (node?.type === 'textGeneration' && (node.textContent || node.storyboardCells?.length)) {
    return '文本生成完成，结果已保存在原文本节点。';
  }
  if (checks.every((check) => check.passed)) return '生成完成，结果已归档并可在原生成节点中查看。';
  if (checks.find((check) => check.id === 'task-completed')?.passed) return '任务结束，但没有形成可展示和归档的有效输出。';
  return '任务未形成可评估的完整结果。';
}

export function evaluateGenerationTask({ project, node, task }: { project: MutableProject; node: Record<string, any>; task: Record<string, any> }): AgentEvaluation | null {
  if (!project || !node || !task || task.status !== 'completed') return null;
  const evaluations = ensureAgentEvaluations(project);
  const existing = evaluations.find((item) => item.taskId === task.id);
  if (existing) return existing;

  const checks = evaluationChecks(task, node);
  const score = Math.round((checks.filter((check) => check.passed).length / checks.length) * 100);
  const resultNodeIds = (task.result?.resultNodes || [])
    .map((item: any) => (typeof item === 'string' ? item : item?.id))
    .filter((id: unknown): id is string => Boolean(id));
  const evaluation = {
    id: uid(),
    type: 'agent-evaluation',
    taskId: task.id,
    nodeId: node.id,
    nodeType: node.type,
    title: `${node.title || task.title || '生成任务'} 评估`,
    evaluationVersion: 2,
    status: checks.every((check) => check.passed) ? 'completed' : 'partial_failed',
    score,
    summary: summaryFromTask(task, checks, node),
    resultNodeIds,
    checks,
    createdAt: new Date().toISOString(),
  };
  evaluations.unshift(evaluation);
  task.agentEvaluationId = evaluation.id;
  node.agentEvaluationId = evaluation.id;
  return evaluation;
}

export function listAgentEvaluations(project: MutableProject): AgentEvaluation[] {
  return ensureAgentEvaluations(project)
    .slice()
    .sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
}

export function findAgentEvaluation(project: MutableProject, id: string): AgentEvaluation | null {
  return ensureAgentEvaluations(project).find((item) => item.id === id || item.taskId === id || item.nodeId === id) || null;
}
