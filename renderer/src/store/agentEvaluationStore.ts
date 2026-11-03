import { t } from '../i18n/index.ts';
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
    { id: 'task-completed', label: t("ui.agentEvaluationStore.text.765b7fbf"), passed: task.status === 'completed' },
    { id: 'has-output', label: t("ui.agentEvaluationStore.text.008f3f29"), passed: hasOutput },
    { id: 'archive-valid', label: t("ui.agentEvaluationStore.text.eceba2f2"), passed: !task.result?.archiveError },
  ];
}

function summaryFromTask(task: Record<string, any>, checks: EvaluationCheck[], node: Record<string, any>): string {
  if (task.result?.archiveError) return t("ui.agentEvaluationStore.text.d93ad0bb", { value0: String(task.result.archiveError) });
  if (node?.type === 'textGeneration' && (node.textContent || node.storyboardCells?.length)) {
    return t("ui.agentEvaluationStore.text.5ac69db6");
  }
  if (checks.every((check) => check.passed)) return t("ui.agentEvaluationStore.text.f7fb5267");
  if (checks.find((check) => check.id === 'task-completed')?.passed) return t("ui.agentEvaluationStore.text.25f4c099");
  return t("ui.agentEvaluationStore.text.2a5e90ea");
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
    title: t("ui.agentEvaluationStore.text.6ed0aa23", { value0: String(node.title || task.title || t("ui.taskAdapter.text.cafe3d5c")) }),
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
