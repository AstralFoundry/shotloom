import type { WorkflowNodeData } from "../canvas/WorkflowCanvas";

/**
 * 一条引用素材。发送前由输入区解析，之后作为消息的一部分持久化，
 * 这样即使用户回看历史或节点已被改动，界面仍能按当时真实的素材呈现。
 */
export interface AgentReference {
  label: string;
  kind: "image" | "video" | "audio" | "file";
  /** 本地绝对路径；远端或无文件时为空。 */
  path: string;
  /** 非本地来源（http/blob/data），交给预览缓存兜底。 */
  url: string;
  nodeId?: string;
}

const mediaKinds = ["image", "video", "audio"] as const;

function mediaKind(declared: string, label: string): AgentReference["kind"] {
  const haystack = `${declared} ${label}`.toLowerCase();
  return mediaKinds.find((kind) => haystack.includes(kind)) || "file";
}

function splitLocation(value: string) {
  const local = /^(https?:|blob:|data:)/i.test(value) ? "" : value;
  return { path: local, url: local ? "" : value };
}

/**
 * 节点引用取用户此刻在画布上看到的那份素材：优先当前选中的生成产物，
 * 其次上传文件，最后才是节点本身，不能盲目取最后一个输出。
 */
export function nodeReference(node: WorkflowNodeData): AgentReference {
  const record = node as Record<string, any>;
  const outputs = Array.isArray(record.generatedOutputs) ? record.generatedOutputs : [];
  const selectedId = String(record.selectedOutputNodeId || "").replace(/^material:/, "");
  const selected =
    outputs.find((item: Record<string, unknown>) => String(item?.id || "") === selectedId) ||
    outputs.filter((item: Record<string, unknown>) => item?.selected).at(-1) ||
    outputs.at(-1);
  const uploaded = (record.uploadedFile || {}) as Record<string, unknown>;
  const source = (selected || record.uploadedFile || record) as Record<string, unknown>;
  const label = String(
    selected?.fileName || uploaded.name || uploaded.fileName || record.title || record.prompt || "未命名节点",
  );
  const location = String(source.filePath || source.path || source.previewUrl || source.url || "");
  return {
    label,
    kind: mediaKind(
      `${source.resourceType || ""} ${source.mimeType || ""} ${record.resourceType || ""} ${record.type || ""}`,
      label,
    ),
    ...splitLocation(location),
    nodeId: node.id,
  };
}

export function fileReference(file: Record<string, unknown>): AgentReference {
  const label = String(file.name || file.fileName || "附件");
  const location = String(file.filePath || file.path || file.previewUrl || file.url || "");
  return {
    label,
    kind: mediaKind(`${file.resourceType || ""} ${file.mimeType || ""}`, label),
    ...splitLocation(location),
  };
}

/** mm:ss；时长未知或异常时不显示角标。 */
export function referenceClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}
