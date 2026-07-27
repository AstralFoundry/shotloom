import { registerCanvasTools } from './canvasTools';
import { registerCatalogTools } from './catalogTools';
import { registerLifecycleTools } from './lifecycleTools';
import { registerShortDramaTools } from './scriptTools';
import { registerProductionPlanTools } from './productionPlanTools';

let registered = false;

export function registerDefaultAgentTools(): void {
  if (registered) return;
  registerCanvasTools();
  registerCatalogTools();
  registerLifecycleTools();
  registerProductionPlanTools();
  registerShortDramaTools();
  registered = true;
}
