import type { WorkflowNodeData } from "../canvas/WorkflowCanvas";

export interface CopilotArtifactRefs {
  nodeIds: string[];
  taskIds: string[];
}

export interface CopilotArtifact {
  nodeId: string;
  focusNodeId: string;
  title: string;
  kind: "image" | "video" | "audio" | "text" | "node";
  path: string;
  fallbackUrl: string;
  excerpt: string;
  status: string;
}

export function artifactsForMessage(
  refs: CopilotArtifactRefs | undefined,
  nodes: WorkflowNodeData[],
): CopilotArtifact[] {
  if (!refs) return [];
  const nodeIds = new Set(refs.nodeIds || []);
  const taskIds = new Set(refs.taskIds || []);
  const outputsBySource = new Set<string>();
  const resourceOutputs: WorkflowNodeData[] = [];
  const embeddedOutputs: WorkflowNodeData[] = [];
  const direct: WorkflowNodeData[] = [];
  for (const node of nodes) {
    if (node.archived) continue;
    const origin = node.generatedFrom as { nodeId?: string; taskId?: string } | undefined;
    if (origin && (nodeIds.has(String(origin.nodeId || "")) || taskIds.has(String(origin.taskId || "")))) {
      resourceOutputs.push(node);
      if (origin.nodeId) outputsBySource.add(origin.nodeId);
    } else if (nodeIds.has(node.id)) {
      direct.push(node);
    }
    if (!Array.isArray(node.generatedOutputs)) continue;
    for (const candidate of node.generatedOutputs as WorkflowNodeData[]) {
      const candidateTaskId = String(candidate.taskId ||
        (candidate.generatedFrom as { taskId?: string } | undefined)?.taskId || "");
      if (!nodeIds.has(node.id) && !taskIds.has(candidateTaskId)) continue;
      const key = String(candidate.id || candidate.filePath || candidate.path || "");
      if (!key) continue;
      embeddedOutputs.push({ ...candidate, generatedFrom: { nodeId: node.id, taskId: candidateTaskId } });
    }
  }
  const seenOutputs = new Set(resourceOutputs.map((node) =>
    String(node.filePath || node.path || node.id)));
  const outputs = [...resourceOutputs];
  for (const candidate of embeddedOutputs) {
    const key = String(candidate.filePath || candidate.path || candidate.id);
    if (seenOutputs.has(key)) continue;
    seenOutputs.add(key);
    outputs.push(candidate);
    const origin = candidate.generatedFrom as { nodeId?: string };
    if (origin.nodeId) outputsBySource.add(origin.nodeId);
  }
  const selected = [
    ...outputs,
    ...direct.filter((node) => !outputsBySource.has(node.id)),
  ];
  return selected.map((node) => {
    const resourceType = String(node.resourceType || node.mimeType || node.type || "").toLowerCase();
    let kind: CopilotArtifact["kind"] = "node";
    if (resourceType.includes("image")) kind = "image";
    else if (resourceType.includes("video")) kind = "video";
    else if (resourceType.includes("audio")) kind = "audio";
    else if (resourceType.includes("text") || node.type === "note") kind = "text";
    const source = String(node.filePath || node.path || node.previewUrl || node.url || "");
    const local = source && !/^(https?:|blob:|data:)/i.test(source) ? source : "";
    const remote = source && !local ? source : "";
    return {
      nodeId: node.id,
      focusNodeId: String((node.generatedFrom as { nodeId?: string } | undefined)?.nodeId || node.id),
      title: String(node.fileName || node.title || "未命名产物"),
      kind,
      path: local,
      fallbackUrl: remote,
      excerpt: kind === "text" ? String(node.content || "") : "",
      status: String(node.status || ""),
    };
  });
}
