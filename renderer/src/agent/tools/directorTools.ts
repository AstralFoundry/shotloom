import { t } from '@/i18n/index';
import { registerAgentTool } from '../core/toolRegistry';
import type { AgentToolContext, AgentToolEffect, JsonObject } from '../core/types';
import {
  directorCommandKind,
  directorCommandsKnown,
  directorCommandNames,
  directorDeskAvailable,
  rememberDirectorCommandKinds,
  runDirectorDeskCommand,
  showDirectorDeskView,
} from '@/services/directorDeskAgentRuntime';

/** 导演台未打开时不应让整轮失败：所有回执都返回可恢复的说明。 */
function directorUnavailable() {
  return {
    success: false,
    applied: false,
    error: t('tool.feedback.director.closed'),
    hint: '先调用 director_workspace_view 的 view=director 打开导演台画布，再重试本操作。',
  };
}

/**
 * 导演台命令的副作用分级。`kind` 由 iframe 的命令表提供（见 host-bridge.ts 的 commandSpecs），
 * 每次 snapshot 后缓存，所以分级始终来自真实命令表而不是本地再抄一份。
 * 尚未读到 snapshot 时按写操作处理——宁可多收一次审批，也不把写操作误判为只读。
 */
function commandEffect(operation: string): AgentToolEffect {
  return directorCommandKind(operation) === 'view' ? 'read' : 'project_write';
}

export function registerDirectorTools(): void {
  registerAgentTool({
    id: 'director_desk_snapshot',
    icon: 'search',
    title: t('tool.title.director_desk_snapshot'),
    description: '读取当前 3D 导演台的完整场景文档、当前选区、播放头、视口和全部可用命令（每条命令带 kind 与参数说明）。任何操作前先调用它取得真实实体 ID、机位 ID、戏段 ID 和合法命令名；操作后再读一次核验结果。',
    effect: 'read',
    activity: 'inspect',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      if (!directorDeskAvailable()) return directorUnavailable();
      try {
        const snapshot = await runDirectorDeskCommand('snapshot') as Record<string, unknown>;
        rememberDirectorCommandKinds(snapshot.commands);
        return { success: true, ...snapshot };
      } catch (error) {
        return { success: false, applied: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  });

  registerAgentTool({
    id: 'director_desk_catalog',
    icon: 'grid',
    title: t('tool.title.director_desk_catalog'),
    description: '读取导演台可添加的素材 ID、可选动作、运镜预设、画幅与帧率。准备 add_asset、add_action、apply_camera_preset 或 export_video_start 时先调用它取真实 ID 与合法枚举。改 patch 类命令（set_camera_field / set_light_field / set_lighting_field / update_room / update_project_settings / set_clip_field）前，先查 catalog.patchFields 拿到该命令的合法字段名与类型——不要从现有对象反推，空字段推不出来。',
    effect: 'read',
    activity: 'inspect',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      if (!directorDeskAvailable()) return directorUnavailable();
      try {
        return { success: true, ...(await runDirectorDeskCommand('catalog') as Record<string, unknown>) };
      } catch (error) {
        return { success: false, applied: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  });

  registerAgentTool({
    id: 'director_desk_query',
    icon: 'list',
    title: t('tool.title.director_desk_query'),
    description: '只读查询：scene_list 列出戏段，scene_read 读取指定戏段，history_status 查询撤销重做，export_video_job 查询视频导出任务进度，scene_summary 取人数/机位数/镜头数与时长，spatial_check 按时间区间采样检查重叠、过近与出画（参数见 snapshot 中该命令的 args）。这些查询不修改工程。',
    effect: 'read',
    activity: 'inspect',
    inputSchema: {
      type: 'object',
      required: ['operation'],
      properties: {
        operation: {
          type: 'string',
          // 只读命令都可以走这条通道，不必经过写审批。
          enum: ['scene_list', 'scene_read', 'history_status', 'export_video_job', 'scene_summary', 'spatial_check'],
        },
        args: { type: 'object', additionalProperties: true },
      },
      additionalProperties: false,
    },
    summarizeInput: (input) => String(input.operation || ''),
    async execute(input) {
      if (!directorDeskAvailable()) return directorUnavailable();
      try {
        return { success: true, result: await runDirectorDeskCommand(String(input.operation), (input.args ?? {}) as Record<string, unknown>) };
      } catch (error) {
        return { success: false, applied: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  });

  registerAgentTool<JsonObject>({
    id: 'director_desk_command',
    icon: 'workflow',
    title: t('tool.title.director_desk_command'),
    description: `调用 3D 导演台的真实编辑命令。operation 必须是 director_desk_snapshot 返回的 commands 中的 name，args 按该命令的 args 说明填写。覆盖实体与机位、戏段时间线与动作、姿态与路径、灯光与环境、撤销重做、工程 JSON 下载以及视频导出任务的启动与取消。

三组值得注意的能力：
- 核验：render_preview_sheet 一次返回最多 8 个真实时间点的带时码拼图，优先用于检查动作、运镜和切镜连续性；render_preview 返回单帧画面；inspect_model 返回建筑或道具的多视角拼图、局部部件尺寸和包围盒；spatial_check 返回区间内的重叠、过近、出画问题列表。这些命令都不改工程。
- 关键帧：record_position_key / record_focal_key 在播放头记录，remove_focal_key 删除。
- 交付：export_shot 按切镜序号导出单镜静帧；export_video_start 支持指定区间与机位。

只读性质的查看命令请用 director_desk_query 或直接读 snapshot。`,
    effect: 'project_write',
    activity: 'canvas',
    // 查看类命令（seek、toggle_play、set_view 等）按只读执行，不触发写操作审批；
    // 分级来自 iframe 命令表的 kind，见上方 commandEffect。
    resolveEffect: (input) => commandEffect(String(input.operation || '')),
    inputSchema: {
      type: 'object',
      required: ['operation'],
      properties: {
        operation: { type: 'string' },
        args: { type: 'object', additionalProperties: true },
      },
      additionalProperties: false,
    },
    summarizeInput: (input) => String(input.operation || ''),
    async execute(input) {
      if (!directorDeskAvailable()) return directorUnavailable();
      const operation = String(input.operation || '');
      const known = directorCommandNames();
      // 首次 snapshot 前没有命令表，不在此拦截；iframe 仍会拒绝未知命令。
      if (directorCommandsKnown() && !known.includes(operation)) {
        return {
          success: false,
          applied: false,
          error: t('tool.feedback.director.unknownCommand', { operation }),
          commands: known,
          hint: 'operation 必须取自 director_desk_snapshot 返回的 commands；先重新读取 snapshot。',
        };
      }
      try {
        const result = await runDirectorDeskCommand(operation, (input.args ?? {}) as Record<string, unknown>);
        // Preview pixels are evidence for the model and user, not a delivered media node.
        const preview = result as { dataUrl?: unknown; seconds?: unknown; timesSec?: unknown; cameraId?: unknown; entityId?: unknown; cells?: unknown; name?: unknown } | null;
        const previewMime = typeof preview?.dataUrl === 'string'
          ? /^data:(image\/(?:png|jpeg));base64,/.exec(preview.dataUrl)?.[1]
          : undefined;
        if (previewMime) {
          const { dataUrl, ...facts } = preview as { dataUrl: string };
          const sheet = Array.isArray(preview?.timesSec);
          const modelSheet = typeof preview?.entityId === 'string' && Array.isArray(preview.cells);
          return {
            success: true,
            applied: false,
            ...facts,
            evidence: modelSheet
              ? '当前建筑或道具的独立多视角渲染；尺寸来自模型几何，不能替代完整场景中的遮挡、光影和空间核验'
              : sheet
                ? '导演台时间线真实渲染帧拼图；每格标注秒数，不含编辑器 UI，需逐格检查连续性'
                : '导演台当前帧渲染结果；仅代表该时间点与该机位的画面，不含浏览器侧叠加的编辑器 UI',
            __toolAttachments: [{
              type: 'file', mime: previewMime,
              filename: modelSheet ? `director-model-${preview.entityId}.jpg` : sheet ? 'director-timeline-sheet.jpg' : `director-${Number(preview?.seconds || 0).toFixed(2)}s.png`,
              url: dataUrl,
            }],
          };
        }
        // 命令可能返回 false 表示未生效（例如撤销栈为空），这不算异常，但要如实上报。
        return { success: result !== false, applied: result !== false, result };
      } catch (error) {
        return { success: false, applied: false, operation, error: error instanceof Error ? error.message : String(error) };
      }
    },
    // 模型看到的画面必须能落到用户屏幕上，核验才有依据。
    summarizeResult: (result: unknown) => {
      const frames = (result as { __toolAttachments?: Array<{ url?: string }> } | null)?.__toolAttachments;
      if (!frames?.length) return undefined;
      const timesSec = (result as { timesSec?: unknown }).timesSec;
      const cells = (result as { cells?: unknown }).cells;
      const seconds = Number((result as { seconds?: number }).seconds);
      const label = Array.isArray(cells)
        ? `${String((result as { name?: unknown }).name || 'model')} · ${cells.length} views`
        : Array.isArray(timesSec)
        ? `${timesSec.length} frames`
        : Number.isFinite(seconds) ? `${seconds.toFixed(1)}s` : t('tool.feedback.director.preview');
      return {
        summary: label,
        previews: frames.flatMap(frame => typeof frame.url === 'string' ? [{ path: frame.url, label }] : []),
      };
    },
  });

  registerAgentTool<JsonObject>({
    id: 'director_workspace_view',
    icon: 'image',
    title: t('tool.title.director_workspace_view'),
    description: '在 Shotloom 工作流画布和 3D 导演台之间切换可见工作区。view=director 打开导演台画布（导演台未打开时其余导演台工具不可用），view=canvas 回到工作流画布。',
    effect: 'agent_state_write',
    activity: 'canvas',
    inputSchema: {
      type: 'object',
      required: ['view'],
      properties: { view: { type: 'string', enum: ['director', 'canvas'] } },
      additionalProperties: false,
    },
    summarizeInput: (input) => String(input.view || ''),
    execute(input: JsonObject, _context: AgentToolContext) {
      const applied = showDirectorDeskView(input.view as 'director' | 'canvas');
      return {
        success: applied,
        applied,
        view: input.view,
        ...(applied ? {} : { error: t('tool.feedback.director.viewUnavailable') }),
      };
    },
  });
}
