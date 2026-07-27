import { BoardNode } from "./BoardNode";
import { defaultNodeRenderers } from "./CanvasNodes";
import { generationNodeRenderers } from "./GenerationNode";
import { ThreeDDirectorNode } from "./ThreeDDirectorNode";
import type { WorkflowNodeRenderer } from "./WorkflowCanvas";

export const workflowNodeRenderers: Record<string, WorkflowNodeRenderer> = {
  ...defaultNodeRenderers,
  ...generationNodeRenderers,
  board: BoardNode,
  threeDDirector: ThreeDDirectorNode,
};
