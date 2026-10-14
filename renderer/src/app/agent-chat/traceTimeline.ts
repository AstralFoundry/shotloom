import type { AgentSubagentView, AgentToolCall } from "./contracts";

/**
 * 运行轨迹的一条时间线：主 Agent 的步骤平铺，子 Agent 派发是一行"谁在执行"，
 * 它的步骤随后归到这个分支下，直到执行者换回父级。
 */
export interface TraceGroup {
  key: string;
  subagent?: AgentSubagentView;
  tools: AgentToolCall[];
}

/**
 * 按事件到达顺序合并工具行与子任务。分组只在执行者会话切换时开始，
 * 因此父级在派发之后继续的步骤不会被并回派发之前。
 */
export function traceGroups(tools: AgentToolCall[], subagents: AgentSubagentView[]): TraceGroup[] {
  const merged: Array<{ seq: number; subagent?: AgentSubagentView; tool?: AgentToolCall }> = [
    ...subagents.map((subagent) => ({ seq: subagent.seq || 0, subagent })),
    ...tools.map((tool) => ({ seq: tool.seq || 0, tool })),
  ].sort((a, b) => a.seq - b.seq);

  const groups: TraceGroup[] = [];
  for (const entry of merged) {
    if (entry.subagent) {
      groups.push({ key: String(entry.subagent.id || ''), subagent: entry.subagent, tools: [] });
      continue;
    }
    const tool = entry.tool!;
    const key = String(tool.agentSessionId || '');
    const last = groups[groups.length - 1];
    // 同一个会话继续执行就归到当前分支：子 Agent 的步骤要挂在自己的派发标题下。
    if (last && last.key === key) last.tools.push(tool);
    else groups.push({ key, tools: [tool] });
  }
  return groups;
}
