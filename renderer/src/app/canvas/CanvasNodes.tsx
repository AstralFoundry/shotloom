import { type ChangeEvent, memo } from "react";
import { IconSymbol } from "../components/IconSymbol";
import { ResourcePreview } from "./ResourcePreview";
import type { WorkflowNodeActions, WorkflowNodeData, WorkflowNodeRenderer } from "./WorkflowCanvas";
import { useImeCommit } from "./imeComposition";

export const NoteNode: WorkflowNodeRenderer = memo(({ node, selected, actions }) => {
  const update = (patch: Record<string, unknown>) =>
    actions.update(node.id, {
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  const titleCommit = useImeCommit<HTMLInputElement>(String(node.title || "便签"), (value) =>
    update({ title: value }),
  );
  const contentCommit = useImeCommit<HTMLTextAreaElement>(String(node.content || ""), (value) =>
    update({ content: value }),
  );
  return (
    <div
      className={`note-node${selected ? " selected" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        actions.select(node.id);
      }}
    >
      <div className="note-head">
        <span className="note-kind" aria-hidden="true">便签</span>
        <input
          className="nodrag"
          aria-label="便签标题"
          placeholder="便签"
          {...titleCommit}
          onClick={(e) => e.stopPropagation()}
        />
        {selected && (
          <div className="note-head-actions">
            <button
              type="button"
              aria-label="删除便签"
              title="删除便签"
              onClick={(e) => {
                e.stopPropagation();
                actions.delete(node.id);
              }}
            >
              <IconSymbol name="trash" />
            </button>
          </div>
        )}
      </div>
      <textarea
        className="nodrag nowheel"
        aria-label="便签内容"
        placeholder="写下批注、想法或给 Agent 的上下文"
        {...contentCommit}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </div>
  );
});

export const UtilityNode: WorkflowNodeRenderer = memo(({ node, selected, actions }) => {
  return (
  <div className="utility-node-wrapper" onClick={(e) => e.stopPropagation()}>
    <div
      className={`utility-node utility-node-${node.type}${selected ? " selected" : ""}`}
      onClick={() => actions.select(node.id)}
    >
      <div className="utility-head">
        <IconSymbol name="image" />
        <input
          className="nodrag"
          value={String(node.title || "资源节点")}
          placeholder="资源节点"
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            actions.update(node.id, { title: e.target.value })
          }
          onClick={(e) => e.stopPropagation()}
        />
        {selected && (
          <button
            className="utility-delete"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              actions.delete(node.id);
            }}
          >
            <IconSymbol name="trash" />
          </button>
        )}
      </div>
      {node.type === "resource" ? (
        <ResourcePreview
          node={node}
          onUse={() => actions.useResource(node.id)}
          onReplace={() => actions.replaceResource(node.id)}
          onArchive={() => actions.archiveResource(node.id)}
        />
      ) : (
        <div className="utility-body">
          {String(node.content || node.fileName || node.filePath || "未配置")}
        </div>
      )}
    </div>
  </div>
  );
});

export const defaultNodeRenderers: Record<string, WorkflowNodeRenderer> = {
  resource: UtilityNode,
  note: NoteNode,
};

export function createNodeActions(actions: WorkflowNodeActions) {
  return actions;
}
