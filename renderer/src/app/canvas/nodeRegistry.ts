import { defaultNodeRenderers } from "./CanvasNodes";
import { generationNodeRenderers } from "./GenerationNode";
import { ThreeDDirectorNode } from "./ThreeDDirectorNode";
import type { WorkflowNodeRenderer } from "./WorkflowCanvas";

export const workflowNodeRenderers: Record<string, WorkflowNodeRenderer> = {
  ...defaultNodeRenderers,
  ...generationNodeRenderers,
  threeDDirector: ThreeDDirectorNode,
};
