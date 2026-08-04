import { type ChangeEvent, memo, useContext } from "react";
import { Handle, Position } from "@xyflow/react";
import { IconSymbol } from "../components/IconSymbol";
import { ResourcePreview } from "./ResourcePreview";
import type { WorkflowNodeActions, WorkflowNodeData, WorkflowNodeRenderer } from "./WorkflowCanvas";
import { MentionContext } from "./WorkflowCanvas";
import { useImeCommit } from "./imeComposition";

function Ports({ className }: { className: string }) {
  return (
    <>
      <Handle
        id="port-left"
        className={`${className} ${className}-in`}
        type="source"
        position={Position.Left}
      />
      <Handle
        id="port-right"
        className={`${className} ${className}-out`}
        type="source"
        position={Position.Right}
      />
    </>
  );
}

export const NoteNode: WorkflowNodeRenderer = memo(({ node, selected, actions }) => {
  const mentionInCopilot = useContext(MentionContext);
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
      <Ports className="note-port" />
      <div className="note-head">
        {mentionInCopilot && (
          <button
            className="node-mention-btn"
            title={`引用节点：${node.title || "便签"}`}
            onClick={(e) => {
              e.stopPropagation();
              mentionInCopilot(node.id);
            }}
          >
            @
          </button>
        )}
        <IconSymbol name="chat" />
        <input
          className="nodrag"
          placeholder="便签"
          {...titleCommit}
          onClick={(e) => e.stopPropagation()}
        />
        {selected && (
          <div className="note-head-actions">
            <button
              title="Delete"
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
        placeholder="写下批注、想法或给 Agent 的上下文"
        {...contentCommit}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </div>
  );
});

export const UtilityNode: WorkflowNodeRenderer = memo(({ node, selected, actions }) => {
  const mentionInCopilot = useContext(MentionContext);
  return (
  <div className="utility-node-wrapper" onClick={(e) => e.stopPropagation()}>
    <div
      className={`utility-node utility-node-${node.type}${selected ? " selected" : ""}`}
      onClick={() => actions.select(node.id)}
    >
      <Ports className="utility-port" />
      <div className="utility-head">
        {mentionInCopilot && (
          <button
            className="node-mention-btn"
            title={`引用节点：${node.title || node.type}`}
            onClick={(e) => {
              e.stopPropagation();
              mentionInCopilot(node.id);
            }}
          >
            @
          </button>
        )}
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
