import { registerCanvasTools } from './canvasTools';
import { registerCatalogTools } from './catalogTools';
import { registerLifecycleTools } from './lifecycleTools';
import { registerShortDramaTools } from './scriptTools';
import { registerProductionPlanTools } from './productionPlanTools';
import { hasAgentTool } from '../core/toolRegistry';

export function registerDefaultAgentTools(): void {
  // The registry and this module can be re-evaluated independently during
  // desktop HMR. The registry is the source of truth; a module-local boolean
  // can reset while canvas_list_nodes is still registered and make every retry fail.
  if (hasAgentTool('canvas_list_nodes')) return;
  registerCanvasTools();
  registerCatalogTools();
  registerLifecycleTools();
  registerProductionPlanTools();
  registerShortDramaTools();
}
