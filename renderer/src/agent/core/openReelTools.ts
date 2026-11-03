import nativeTools from '../../config/openreel-agent-tools.json' with { type: 'json' };
import policy from '../../config/openreel-agent-policy.json' with { type: 'json' };
import type { JsonSchema } from './types';

interface NativeOpenReelTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  readOnly: boolean;
  destructive: boolean;
  expensive: boolean;
}

// Keep the upstream inventory intact; product registration and role permissions
// share this supported subset instead of advertising absent optional backends.
export const openReelAgentTools = (nativeTools as unknown as NativeOpenReelTool[])
  .filter(tool => !Object.hasOwn(policy.excludedTools, tool.name));

export function supportsEditorTool(toolId: string, desktopProject: boolean): boolean {
  if (toolId === 'video_project_export' || toolId === 'video_project_frame') return desktopProject;
  if (!toolId.startsWith('openreel_')) return true;
  const name = toolId.slice('openreel_'.length);
  if (Object.hasOwn(policy.excludedTools, name)) return false;
  return desktopProject || !policy.desktopProjectTools.includes(name);
}
