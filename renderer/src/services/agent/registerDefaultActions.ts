import { missingActionHandlers, registerAction } from './actionRegistry';
import { handleAgentCanvasAction } from '@/services/agentCanvasActionHandler';
import { handleAgentGenerationAction } from '@/services/agentGenerationActionHandler';
import { handleAgentTaskAction } from '@/services/agentTaskActionHandler';

let registered = false;

const generationActions = ['create_gen_node', 'place_asset_on_canvas', 'update_gen_config'];
const taskActions = ['start_generation'];
const canvasActions = [
  'create_note_node', 'connect_nodes', 'delete_node', 'delete_edge', 'move_node', 'toggle_edge',
];
export const defaultRegisteredActionTypes = [
  ...generationActions, ...taskActions, ...canvasActions,
];

function register(types: string[], handler: (action: any, context: any) => any) {
  types.forEach((type) => registerAction(type, handler));
}

/**
 * 显式注册所有默认 Action，避免依赖模块副作用或打包器是否保留未使用 import。
 * 启动时同时检查遗漏处理器，使“已暴露但无法执行”的 Action 尽早失败。
 */
export function registerDefaultAgentActions(): void {
  if (registered) return;
  registered = true;
  register(generationActions, handleAgentGenerationAction);
  register(taskActions, handleAgentTaskAction);
  register(canvasActions, handleAgentCanvasAction);
  const missing = missingActionHandlers(defaultRegisteredActionTypes);
  if (missing.length) throw new Error(`Agent action handlers failed to register: ${missing.join(', ')}`);
}
