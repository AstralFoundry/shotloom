import { t } from '@/i18n';
import { editorLocalMedia } from "../editor/editorLocalMedia";
import { memo, useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "@xyflow/react";
import { store, touchProject } from "../../store/projectStore";
import { getAgentProjectFenceKey } from "../../services/agentProjectIdentity";
import { IconSymbol } from "../components/IconSymbol";
import { VideoEditorWorkspace } from "../editor/VideoEditorWorkspace";
import { CanvasNodeLabelRootContext, type WorkflowNodeRenderer } from "./WorkflowCanvas";

/** One stable native timeline per node; selection only toggles the floating preview. */
export const ClipStudioNode: WorkflowNodeRenderer = memo(({ node, selected, actions }) => {
  const dragging = useStore((state) => Boolean(state.nodeLookup.get(node.id)?.dragging));
  const labelRoot = useContext(CanvasNodeLabelRootContext);
  const [expanded, setExpanded] = useState(false);
  const owner = store.project;
  const controller = useMemo(() => ({
    ...editorLocalMedia,
    persist(project: Record<string, unknown>) {
      if (store.project !== owner) return;
      const target = owner.nodes.find((item: any) => item.id === node.id);
      if (!target) return;
      target.videoEditProject = project;
      touchProject({ sessionDelay: 300, coalesceSession: true });
    },
    activate() { actions.select(node.id); },
    close() {
      if (expanded) setExpanded(false);
      else actions.select("");
    },
    expand() { setExpanded(true); },
  }), [actions, expanded, node.id, owner]);
  return <div className={`clip-studio-node${selected ? " selected" : ""}`} data-clip-node-id={node.id}>
    {labelRoot && createPortal(<div className="work-node-kicker" style={{
      pointerEvents: "auto", cursor: "grab",
    }}>
      <IconSymbol className="work-node-type-icon" name="scissors" aria-hidden="true" />
      <span>{String(node.title || t("ui.videoEditorActions.text.801f1d23"))}</span>
    </div>, labelRoot)}
    <div className="clip-studio-placeholder" role="status">{t("ui.ClipStudioNode.text.f46bb8e2")}</div>
    <VideoEditorWorkspace key={getAgentProjectFenceKey()} nodeId={node.id} expanded={expanded} canvasNode selected={selected && !dragging}
      title={String(node.title || t("ui.videoEditorActions.text.801f1d23"))} project={node.videoEditProject as Record<string, unknown>}
      controller={controller} agentPanel />
  </div>;
});
