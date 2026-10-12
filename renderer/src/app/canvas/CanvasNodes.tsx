import { type ChangeEvent, memo } from "react";
import { IconSymbol } from "../components/IconSymbol";
import { ResourcePreview } from "./ResourcePreview";
import type { WorkflowNodeActions, WorkflowNodeData, WorkflowNodeRenderer } from "./WorkflowCanvas";

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
};

export function createNodeActions(actions: WorkflowNodeActions) {
  return actions;
}
