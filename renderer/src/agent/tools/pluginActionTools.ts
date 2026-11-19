import { registerAgentTool } from '../core/toolRegistry';
import { registeredCapabilities, capabilityConnections } from '../../domain/provider/plugins/PluginCapabilities';
import { prepareCanvasPluginAction, runCanvasPluginAction, type PluginActionRequest } from '../../store/pluginActionStore';
import { settingsStore } from '../../store/settingsStore';
import { assertAgentProject } from '../../services/agentProjectIdentity';
import { t } from '../../i18n';
import type { AgentToolContext, JsonObject, JsonSchema } from '../core/types';

function assertContext(context: AgentToolContext) {
  assertAgentProject(context.projectKey, context.projectInstanceId, context.projectGeneration);
}
const schema = {
  type: 'object', required: ['key', 'connectionId', 'inputs'],
  properties: { key: { type: 'string' }, connectionId: { type: 'string' },
    inputs: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
    parameters: { type: 'object', additionalProperties: true } }, additionalProperties: false,
} satisfies JsonSchema;
export function registerPluginActionTools() {
  registerAgentTool({ id: 'inspect_plugin_capabilities', title: t('pluginActions.inspect'), icon: 'blocks', effect: 'read',
    description: 'Discover installed and enabled plugin processing capabilities, input/output slots, parameters and connection IDs. No credentials returned.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute(_input, context) {
      assertContext(context);
      return { capabilities: registeredCapabilities().map(c => ({ ...c, connections: capabilityConnections(c.reference.id).map(connection => ({ id: connection.id, name: connection.name })) })) };
    } });
  registerAgentTool({ id: 'prepare_plugin_action', title: t('pluginActions.prepare'), icon: 'blocks', effect: 'read',
    description: 'Check a plugin capability, named input node IDs, connection and parameters. Returns correctable errors. Does not submit or modify the canvas.',
    inputSchema: schema,
    execute(input, context) { assertContext(context); return prepareCanvasPluginAction(input as unknown as PluginActionRequest); } });
  registerAgentTool({ id: 'run_plugin_action', title: t('pluginActions.run'), icon: 'blocks', effect: 'media_generation',
    description: 'Run an installed plugin capability on named input nodes. May upload media and incur service charges. Creates a durable background task without an intermediate canvas node; a task ID means started, not completed. Use inspect_tasks to verify real results. Reuse submissionId only for the same request.',
    inputSchema: { ...schema, required: [...schema.required, 'submissionId'], properties: { ...schema.properties, submissionId: { type: 'string' } } },
    isAvailable: context => context.capabilities.nodeExecution && settingsStore.agentCanRunNodes === true,
    async execute(input: JsonObject, context) {
      assertContext(context);
      if (!context.capabilities.nodeExecution || settingsStore.agentCanRunNodes !== true) throw new Error('Agent node execution is disabled');
      return runCanvasPluginAction(input as unknown as PluginActionRequest, String(input.submissionId));
    } });
}
