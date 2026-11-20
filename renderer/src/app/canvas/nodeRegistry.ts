import { PluginProcessingNode } from './PluginProcessingNode';
import { ClipStudioNode } from "./ClipStudioNode";
import { defaultNodeRenderers } from "./CanvasNodes";
import { generationNodeRenderers } from "./GenerationNode";
import { PrevisWorldNode } from "./PrevisWorldNode";
import type { WorkflowNodeRenderer } from "./WorkflowCanvas";

export const workflowNodeRenderers: Record<string, WorkflowNodeRenderer> = {
  ...defaultNodeRenderers,
  ...generationNodeRenderers,
  threeDDirector: PrevisWorldNode,
  clipStudio: ClipStudioNode,
  pluginProcessing: PluginProcessingNode,
};
