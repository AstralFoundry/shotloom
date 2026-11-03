import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'shotloom-plugin'
// The official web profile owns the agent loop and chat renderer. This plugin
// only contributes Shotloom's product tools; it must not start a second loop or
// translate official chat events into the legacy renderer protocol.
export const inject = ['tools']

const bridgeUrl = () => String(process.env.SHOTLOOM_BRIDGE_URL || '').replace(/\/$/, '')
const bridgeToken = () => String(process.env.SHOTLOOM_BRIDGE_TOKEN || '')

async function dispatch(toolName, input, exec) {
  const base = bridgeUrl()
  if (!base) throw new Error('Shotloom Bridge is not configured')
  const response = await fetch(`${base}/tool`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      op: 'tool',
      token: bridgeToken(),
      requestId: `${exec.callId}:${Date.now()}`,
      sessionId: exec.agent?.session?.id,
      toolName,
      input,
    }),
    signal: exec.signal,
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.success === false) throw new Error(String(body.error || `Shotloom tool failed (${response.status})`))
  return body.result
}

export function apply(ctx) {
  const register = (name, description, parameters, input = (args) => args, dispatchName = name) => {
    ctx.tools.register(defineTool({
      name, description, parameters,
      output: { schema: { type: 'object', additionalProperties: true } },
      async execute(args, exec) {
        const payload = input(args)
        return dispatch(dispatchName === 'shotloom_tool' ? payload.toolName : dispatchName, dispatchName === 'shotloom_tool' ? payload.input : payload, exec)
      },
    }))
  }
  register('project_snapshot', 'Read the complete current Shotloom project snapshot, including nodes and edges.', {})
  register('canvas_list_nodes', 'Read the current Shotloom canvas nodes and their real output state.', {})
  register('canvas_move_nodes', 'Move existing Shotloom canvas nodes to explicit coordinates.', {
    positions: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
      id: { type: 'string', required: true }, x: { type: 'number', required: true }, y: { type: 'number', required: true },
    } } },
  })
  register('project_save', 'Persist the current Shotloom project to disk and return the native save receipt.', {})
  register('project_export_package', 'Export the current Shotloom project package and return the native export receipt.', {})
  register('shotloom_tool', 'Execute a Shotloom product operation by exact tool id and JSON input.', {
    toolName: { type: 'string', required: true },
    input: { type: 'object', required: true, additionalProperties: true },
  }, (args) => args, 'shotloom_tool')
}

