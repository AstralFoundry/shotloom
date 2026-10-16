import { CANVAS_AGENT_ID, EDITOR_AGENT_ID, TEXT_AGENT_ID } from "../../agent/agents/definitions";

/**
 * 同一个聊天面板服务多个工作区 Agent，界面文案在这里按 Agent 声明一次；
 * 面板组件不再用布尔开关去猜"现在是哪个作用域"。
 */
export interface AgentPresentation {
  /** 固定面板标题；画布面板显示当前会话标题，因此不声明。 */
  title?: string;
  placeholder: string;
  skillLabel: string;
  emptyTitle: string;
  emptyText: string;
}

const presentations: Record<string, AgentPresentation> = {
  [CANVAS_AGENT_ID]: {
    placeholder: "输入消息，@ 引用画布节点…",
    skillLabel: "技能",
    emptyTitle: "描述你想完成的内容",
    emptyText: "也可以用 @ 引用画布节点，Agent 会结合当前内容继续创作",
  },
  [EDITOR_AGENT_ID]: {
    title: "剪辑 Agent",
    placeholder: "描述剪辑要求…",
    skillLabel: "剪辑 Skill",
    emptyTitle: "直接描述想怎么剪",
    emptyText: "例如：剪掉开头两秒，把结尾字幕改成“谢谢观看”。Agent 会读取当前时间线再操作。",
  },
  [TEXT_AGENT_ID]: {
    title: "文本 Agent",
    placeholder: "说明要怎么改这篇内容…",
    skillLabel: "文本 Skill",
    emptyTitle: "直接说要怎么写",
    emptyText: "例如：把这段改得更口语、按镜头拆分、补一段结尾。Agent 会先读取编辑器里的当前内容再动笔。",
  },
};

export function agentPresentation(agentId: string): AgentPresentation {
  const presentation = presentations[String(agentId || "")];
  if (!presentation) {
    throw new Error(`未知的 Agent 界面呈现：${agentId || "(空)"}。面板文案必须先在 agent-chat/agentPresentation.ts 中声明`);
  }
  return presentation;
}
