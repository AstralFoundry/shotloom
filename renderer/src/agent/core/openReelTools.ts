import nativeTools from '../../config/openreel-agent-tools.json' with { type: 'json' };
import policy from '../../config/openreel-agent-policy.json' with { type: 'json' };
import type { JsonSchema } from './types';

interface NativeOpenReelTool {
  name: string;
  domain: string;
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

/**
 * 常驻上下文的核心工具：时间线读写、字幕、声音、基础变换与导出。
 *
 * 其余（Motion 合成、Creation 三维、调色、变速曲线、多机位等约 250 个）默认不进入
 * 模型请求，由 `editor_find_tools` 按需解锁。309 个工具的 schema 合起来约 4.8 万
 * token，全量注入会淹没提示词规则并拖慢每次请求；而剪辑的绝大多数轮次只用到这里。
 * 这里是「默认可见」而不是「唯一可用」——发现工具解锁后与核心工具同等可调用。
 */
export const EDITOR_CORE_TOOL_NAMES: readonly string[] = [
  // 读取真实状态与 ID
  'get_editor_state', 'list_media', 'list_tracks', 'list_clips', 'get_clip', 'get_capabilities',
  // 工程
  'create_project', 'open_project', 'save_project', 'update_project_settings', 'set_canvas_background',
  // 轨道
  'add_track', 'remove_track', 'rename_track', 'reorder_track', 'mute_track', 'lock_track', 'hide_track', 'solo_track',
  // 片段
  'add_clip', 'remove_clip', 'move_clip', 'trim_clip', 'split_clip', 'ripple_delete_clip',
  'slip_clip', 'slide_clip', 'roll_edit', 'trim_to_playhead', 'close_gap',
  // 素材
  'delete_media', 'rename_media',
  // 变换与合成基础
  'set_clip_transform', 'set_clip_blend_mode', 'set_clip_blend_opacity',
  // 变速
  'set_clip_speed', 'set_clip_reverse',
  // 文字与字幕
  'create_text_clip', 'update_text_clip', 'remove_text_clip',
  'add_subtitle', 'remove_subtitle', 'update_subtitle', 'import_srt', 'set_subtitle_style',
  // 音量与声音基础
  'set_clip_volume', 'set_clip_fade',
  // 转场
  'add_transition', 'update_transition', 'remove_transition',
  // 导出
  'export_video', 'export_audio',
  // 桌面工程专属（是否真的可用由 supportsEditorTool 判定）
  'import_media_from_url', 'export_creation_scene_gltf', 'queue_motion_render', 'run_motion_render_queue',
  // Skill 直接点名的 Motion / Creation 入口
  'create_motion_composition', 'insert_motion_into_editor', 'create_creation_3d_scene',
  'inspect_3d_model', 'render_creation_preview', 'export_motion_video',
];

const coreToolNames = new Set(EDITOR_CORE_TOOL_NAMES);

/** 核心集之外的原生工具是否已由发现工具解锁。会话级集合，键为 conversationId。 */
const unlockedNativeTools = new Map<string, Set<string>>();

export function nativeToolUnlocked(name: string, conversationId: string): boolean {
  return coreToolNames.has(name) || (unlockedNativeTools.get(conversationId)?.has(name) ?? false);
}

export function unlockNativeTools(names: readonly string[], conversationId: string): void {
  const existing = unlockedNativeTools.get(conversationId) || new Set<string>();
  for (const name of names) if (!coreToolNames.has(name)) existing.add(name);
  unlockedNativeTools.set(conversationId, existing);
}

export function clearUnlockedNativeTools(): void {
  unlockedNativeTools.clear();
}

/** 按关键词检索原生工具，供 `editor_find_tools` 使用。标题与描述来自上游目录，不做本地改写。 */
export function searchOpenReelTools(query: string, limit: number) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const scored = openReelAgentTools.map(tool => {
    const haystack = `${tool.name} ${tool.title} ${tool.description} ${tool.domain}`.toLowerCase();
    const hits = terms.filter(term => haystack.includes(term)).length;
    return { tool, hits };
  }).filter(item => item.hits > 0);
  // 命中全部关键词的排在前面，命中越多越靠前；同分保持上游顺序，结果可复现。
  scored.sort((a, b) => b.hits - a.hits);
  return scored.slice(0, limit).map(item => item.tool);
}

export function supportsEditorTool(toolId: string, desktopProject: boolean): boolean {
  if (toolId === 'video_project_export' || toolId === 'video_project_frame') return desktopProject;
  if (!toolId.startsWith('openreel_')) return true;
  const name = toolId.slice('openreel_'.length);
  if (Object.hasOwn(policy.excludedTools, name)) return false;
  return desktopProject || !policy.desktopProjectTools.includes(name);
}
