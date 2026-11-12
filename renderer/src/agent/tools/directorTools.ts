import { t } from '@/i18n/index';
import { registerAgentTool } from '../core/toolRegistry';
import type { AgentToolContext, AgentToolEffect, JsonObject } from '../core/types';
import {
  DirectorDeskError,
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
 * 失败回执压成一层：`success` 恒为 false，原因在 `error`，可执行线索在 `hint`，
 * 结构化的 `code` 与事实（例如 `currentRevision`）平铺在同一层。
 * 模型看中文 message 判断怎么改，`code` 让调用方与测试不必依赖措辞。
 */
function directorFailure(error: unknown) {
  const failure = error instanceof DirectorDeskError ? error : null;
  return {
    success: false,
    applied: false,
    error: error instanceof Error ? error.message : String(error),
    ...(failure?.code ? { code: failure.code } : {}),
    ...(failure?.hint ? { hint: failure.hint } : {}),
    ...(failure?.facts ? failure.facts : {}),
  };
}

/** 命令表版本号：宿主带上一次的版本，未变化时快照不再重复返回 8.6KB 的静态契约。 */
let knownCommandsVersion = '';

/**
 * 导演台命令的副作用分级。`kind` 由 iframe 的命令表提供（见 host-bridge.ts 的 commandSpecs），
 * 每次 snapshot 后缓存，所以分级始终来自真实命令表而不是本地再抄一份。
 * 尚未读到 snapshot 时按写操作处理——宁可多收一次审批，也不把写操作误判为只读。
 */
function commandEffect(operation: string): AgentToolEffect {
  return directorCommandKind(operation) === 'view' ? 'read' : 'project_write';
}

export function registerDirectorTools(): void {
  registerAgentTool<JsonObject>({
    id: 'director_desk_snapshot',
    icon: 'search',
    title: t('tool.title.director_desk_snapshot'),
    description: `读取当前 3D 导演台的场景文档、当前选区、播放头、视口和可用命令（每条命令带 kind 与参数说明）。任何操作前先调用它取得真实实体 ID、机位 ID、戏段 ID 和合法命令名；操作后再读一次核验结果。

大场景请用 detail:"summary"：实体只返回 id、名称、类型、位置、朝向、缩放、路径点数与动作片段，足够判断走位和时长，体积约为完整文档的 1/6。需要完整字段（姿态、参数、模型细节）时省略 detail 或传 "full"。只想看某几个实体时传 entityIds 过滤。

commands 只列出你应当使用的命令；编辑器内部命令（选区、视口、逐轴、逐步画路径等）默认不返回，hiddenCommands 是它们的数量。确实需要时可以传 includeAll:true 取全表，但它们不会通过 director_desk_command 执行——写操作请走 director_desk_batch。

第一次调用返回 commands 表；回执里的 commandsVersion 可以直接带回来，未变化时只回 commandsUnchanged:true。`,
    effect: 'read',
    activity: 'inspect',
    inputSchema: {
      type: 'object',
      properties: {
        detail: { type: 'string', enum: ['summary', 'full'] },
        entityIds: { type: 'array', items: { type: 'string' } },
        commandsVersion: { type: 'string' },
        includeAll: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    summarizeInput: (input) => (input.detail === 'summary' ? 'summary' : 'full'),
    async execute(input) {
      if (!directorDeskAvailable()) return directorUnavailable();
      try {
        const snapshot = await runDirectorDeskCommand('snapshot', {
          ...(input.detail ? { detail: input.detail } : {}),
          ...(Array.isArray(input.entityIds) && input.entityIds.length ? { entityIds: input.entityIds } : {}),
          ...(knownCommandsVersion ? { commandsVersion: knownCommandsVersion } : {}),
          ...(input.includeAll === true ? { includeAll: true } : {}),
        }) as Record<string, unknown>;
        if (snapshot.commandsUnchanged !== true) rememberDirectorCommandKinds(snapshot.commands);
        if (typeof snapshot.commandsVersion === 'string') knownCommandsVersion = snapshot.commandsVersion;
        return { success: true, ...snapshot };
      } catch (error) {
        return directorFailure(error);
      }
    },
  });

  registerAgentTool<JsonObject>({
    id: 'director_desk_catalog',
    icon: 'grid',
    title: t('tool.title.director_desk_catalog'),
    description: `读取导演台可添加的素材、可选动作、运镜预设、画幅与帧率。准备 add_asset、add_action、apply_camera_preset 或 export_video_start 时先调用它取真实 ID 与合法枚举。assetConventions 说明单位与原点约定（原点在底面中心，position.y 即落地高度）。改 patch 类命令（set_camera_field / set_light_field / set_lighting_field / update_room / update_project_settings / set_clip_field）前，先查 catalog.patchFields 拿到该命令的合法字段名与类型——不要从现有对象反推，空字段推不出来。

素材有 200 多条，默认不返回：不传参数时只给 groups（分组名、条目数、示例 id）和 assetTotal。要找具体的墙、门窗、建筑、家具时按需筛：
- group 传分组名（例如 "建筑构件"、"建筑外壳"、"通行构件"、"家具"、"人物"），返回该组完整条目；
- query 传关键词（可中英文，例如 wall、墙、building、楼、door、桌），按 id／名称／分组／别名匹配；
两个都给时取交集。每条含 id、name、kind、group、defaultSize（默认宽高深）与 params（可调的尺寸参数名，有 params 的用 parameters 写真实尺寸而不是 scale）。`,
    effect: 'read',
    activity: 'inspect',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        group: { type: 'string' },
      },
      additionalProperties: false,
    },
    summarizeInput: (input) => String(input.group || input.query || 'all'),
    async execute(input) {
      if (!directorDeskAvailable()) return directorUnavailable();
      try {
        const args = {
          ...(typeof input.query === 'string' && input.query.trim() ? { query: input.query.trim() } : {}),
          ...(typeof input.group === 'string' && input.group.trim() ? { group: input.group.trim() } : {}),
        };
        return { success: true, ...(await runDirectorDeskCommand('catalog', args) as Record<string, unknown>) };
      } catch (error) {
        return directorFailure(error);
      }
    },
  });

  registerAgentTool({
    id: 'director_desk_query',
    icon: 'list',
    title: t('tool.title.director_desk_query'),
    description: '只读查询：scene_list 列出戏段，scene_read 读取指定戏段，history_status 查询撤销重做，export_video_job 查询视频导出任务进度，scene_summary 取人数/机位数/镜头数与时长，spatial_check 按时间区间采样检查重叠、过近、出画、机位卡在墙体内部与主体被遮挡（参数见 snapshot 中该命令的 args）。这些查询不修改工程。',
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
        return directorFailure(error);
      }
    },
  });

  registerAgentTool<JsonObject>({
    id: 'director_desk_batch',
    icon: 'workflow',
    title: t('tool.title.director_desk_batch'),
    description: `一次原子批量设置当前导演台：edits 非空，建议按相关修改分批、每批 1–8 项；这是调用建议，超过 8 项仍可提交，没有硬性数量上限。全部成功才写入，形成一条撤销记录；任一项失败则整批回滚并指出第几项。先读 director_desk_snapshot，expectedRevision 必须等于其 revision；实体、片段 ID 必须取自 snapshot。执行后再读 snapshot 和预览核验。

这是搭建场景的主力工具：新增实体、机位、切镜都在这里，不要退化成逐条命令或整文档导入。

edits 按顺序执行，支持：
- add_asset：assetId（取 catalog.assets[].id）+ 可选 name、position:[x,y,z]、rotationDegrees:[x,y,z]、scale:[x,y,z]、parameters；回执含新 entityId。素材原点在底面中心，position 的 y 就是落地高度（y=0 正好站在地面），默认尺寸见 catalog.assets[].defaultSize，不必先加再量。
- add_prop：目录里没有的物体用它拼，而不是拿外形无关的道具改名冒充。parts:[{ shape, at:[x,y,z], size?:[w,h,d], rotationDegrees?, color? }]（1–32 个部件，shape 取形状素材 shape-*，尺寸单位米）+ 可选 name、position:[x,y,z]、rotationDegrees、scale、color（整件的基础色，默认 #d5d5d0；说明是灰模，尽量用灰阶）。部件位置是相对基座的米制坐标，且每个部件的 at 指它的底面中心（和实体本身同一约定）：一个高 0.18 米的柱体放在 y=0 才会贴地，放在 y=0.09 就会悬空 0.09 米。适合灰模示意（篝火、简易乐器、特定家具、道具堆），不适合需要精细曲面的主体；拼完用 inspect_model 看形状、再用场景预览确认它在镜头里的比例与落地关系。
- add_room：minX + maxX + minZ + maxZ（矩形房间范围，米）+ 可选 height（默认 3）、thickness（默认 0.18）、y（底面高度，默认 0）、name、floor:true（同时铺一块楼板地板）。四面墙自动首尾对齐、墙角按半个墙厚避让。可选 openings:[{ side:"south"|"north"|"east"|"west", width, height?, sill?, offset? }] 在对应墙面开门窗；offset 是沿墙段方向的偏移（0 居中），是负数就朝起始端偏。回执的 entities 按「南、北、西、东（、地板）」给出各面墙的 id。同一面墙只能开一个洞，需要多个就用 add_wall 把该侧拆段。
- add_wall：from:[x,z] + to:[x,z]（俯视平面上的墙体线段，米）+ 可选 height（默认 3）、thickness（默认 0.18）、opening:{ width, height?, sill?, offset? }（门窗洞；offset 为沿墙段方向的偏移，0 居中）、y（底面高度，默认 0）、name。一面墙一项，中心、朝向和长度由线段直接算出，不需要手算 scale 或角度；孤立的单面墙或非矩形墙体时用它。
- add_camera：可选 name、position、rotationDegrees；回执含新 entityId。
- add_cut：timeSec（秒，须小于工程时长）+ cameraId；同一时刻已有切镜则替换机位。
- set_path：entityId + points:[{ position:[x,y,z], timeSec }]（至少 2 个，timeSec 严格递增）+ 可选 smooth（默认 true）。一次写入整条运动路径，不依赖选区与播放头；路径首点位置即成为实体基座位置。跟随机位需先把 camera.mode 设为 free。
- set_entity：entityId + patch；字段 name、color、position:[x,y,z]（米，世界坐标，整条路径平移）、rotationDegrees:[x,y,z]（度）、scale:[x,y,z]、parameters、visible、height、build、gender。parameters 是素材的真实尺寸参数（米），键名取自 catalog.assets[].params，例如墙的 width/height/depth/openingWidth；有参数的素材优先改参数而不是 scale，scale 会把门洞和墙厚一起拉伸。跟随机位不能直接设位置或旋转，手持道具不能直接设位置。
- set_camera / set_light：entityId + patch；字段从 director_desk_catalog.patchFields.set_camera_field / set_light_field 取。
- set_lighting / set_room / set_project：patch；字段分别从 catalog.patchFields.set_lighting_field / update_room / update_project_settings 取。
- add_action：entityId + action（取 catalog.actions）+ 可选 atSec（秒，默认 0）；放在该时点之后第一个不重叠位置，返回新 clipId。已有待机片段可能把新动作推到其末尾。
- set_clip：entityId + clipId + patch；只支持 start、end、speed。
- remove_clip：entityId + clipId；可先移除默认待机，再在同一批添加新动作。
- delete_entity：entityId；会清掉指向它的机位视线、朝向、手持绑定，并把它占用的切镜改到另一台机位。
- duplicate_entity：entityId + 可选 name、position、rotationDegrees；给 position 时整条路径随之平移，不给则在原型旁边 0.4 米处复制。
每项 patch 至少一个字段。导出、场景切换和视口操作不在批量内。按语义和可核验的工作单元分批，不要为了凑数合并无关修改。

回执里如果有 warnings，说明这批放下或移动的物体悬空了（底面离地、也没有搭在任何落地的物体上），先按提示修正再继续搭建。

拿不准整批能不能通过时传 validateOnly:true：它按真实规则校验一遍、不写入任何东西，回执列出每一处问题（含第几项）；改完再用同一批、不带 validateOnly 提交。大批量首次提交前值得先预检一次。`,
    effect: 'project_write',
    activity: 'canvas',
    inputSchema: {
      type: 'object', required: ['expectedRevision', 'edits'], additionalProperties: false,
      properties: {
        expectedRevision: { type: 'integer' },
        validateOnly: { type: 'boolean' },
        edits: {
          type: 'array', minItems: 1,
          items: {
            type: 'object', required: ['operation'], additionalProperties: false,
            properties: {
              operation: {
                type: 'string',
                enum: [
                  'set_entity', 'set_camera', 'set_light', 'set_lighting', 'set_room', 'set_project',
                  'set_path', 'add_asset', 'add_wall', 'add_room', 'add_prop', 'add_camera', 'add_cut', 'add_action', 'set_clip', 'remove_clip',
                  'delete_entity', 'duplicate_entity',
                ],
              },
              entityId: { type: 'string' }, clipId: { type: 'string' }, action: { type: 'string' }, atSec: { type: 'number' },
              assetId: { type: 'string' }, name: { type: 'string' }, cameraId: { type: 'string' },
              position: { type: 'array', items: { type: 'number' } },
              rotationDegrees: { type: 'array', items: { type: 'number' } },
              scale: { type: 'array', items: { type: 'number' } },
              parameters: { type: 'object', additionalProperties: { type: 'number' } },
              from: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
              to: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
              minX: { type: 'number' }, maxX: { type: 'number' },
              minZ: { type: 'number' }, maxZ: { type: 'number' },
              floor: { type: 'boolean' },
              openings: {
                type: 'array',
                items: {
                  type: 'object', required: ['side', 'width'], additionalProperties: false,
                  properties: {
                    side: { type: 'string', enum: ['south', 'north', 'east', 'west'] },
                    width: { type: 'number' }, height: { type: 'number' }, sill: { type: 'number' },
                    offset: { type: 'number' },
                  },
                },
              },
              height: { type: 'number' },
              thickness: { type: 'number' },
              y: { type: 'number' },
              color: { type: 'string' },
              parts: {
                type: 'array', minItems: 1, maxItems: 32,
                items: {
                  type: 'object', required: ['shape', 'at'], additionalProperties: false,
                  properties: {
                    shape: { type: 'string' },
                    at: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
                    size: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
                    rotationDegrees: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
                    color: { type: 'string' },
                  },
                },
              },
              opening: {
                type: 'object', required: ['width'], additionalProperties: false,
                properties: { width: { type: 'number' }, height: { type: 'number' }, sill: { type: 'number' }, offset: { type: 'number' } },
              },
              timeSec: { type: 'number' },
              smooth: { type: 'boolean' },
              points: {
                type: 'array', minItems: 2,
                items: {
                  type: 'object', required: ['position', 'timeSec'], additionalProperties: false,
                  properties: {
                    position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
                    timeSec: { type: 'number' },
                  },
                },
              },
              patch: { type: 'object', additionalProperties: true },
            },
          },
        },
      },
    },
    summarizeInput: input => `${Array.isArray(input.edits) ? input.edits.length : 0} 项`,
    async execute(input) {
      if (!directorDeskAvailable()) return directorUnavailable();
      try {
        const result = await runDirectorDeskCommand('batch_edit', input as Record<string, unknown>) as Record<string, unknown>;
        return { success: true, ...result };
      } catch (error) {
        return directorFailure(error);
      }
    },
  });

  registerAgentTool<JsonObject>({
    id: 'director_desk_command',
    icon: 'workflow',
    title: t('tool.title.director_desk_command'),
    description: `调用 3D 导演台的真实编辑命令。operation 必须是 director_desk_snapshot 返回的 commands 中的 name，args 按该命令的 args 说明填写。覆盖实体与机位、戏段时间线与动作、姿态与路径、灯光与环境、撤销重做、工程 JSON 下载以及视频导出任务的启动与取消。

三组值得注意的能力：
- 核验：render_preview_sheet 一次返回最多 8 个真实时间点的带时码拼图，优先用于检查动作、运镜和切镜连续性；render_preview 返回单帧画面；render_plan 返回整套布景的俯视平面图（剖切掉顶板，带米制坐标网格、人物路径和机位），用来对照俯视的布局参考图；inspect_model 只支持建筑和道具（人物请用场景预览），返回多视角拼图、局部部件尺寸和包围盒；spatial_check 返回区间内的重叠、过近、出画、机位卡墙、主体被遮挡与悬空列表。这些命令都不改工程。
- 关键帧：record_position_key / record_focal_key 在播放头记录，remove_focal_key 删除。
- 交付：export_shot 按切镜序号导出单镜静帧；export_video_start 支持指定区间与机位。

逐轴命令（set_position_axis / set_rotation_axis / set_scale_axis）只服务编辑器内交互；要改坐标、朝向或尺寸，用 director_desk_batch 的 set_entity 向量补丁（position、rotationDegrees、scale），不要逐轴拼。

编辑器内部命令（选区、视口、逐轴、逐步画路径、录制关键帧等）不在 snapshot 的 commands 里，传它们会被拒绝并提示该改用的 batch 写法；不要用 includeAll 去找替代路径，写操作一律走 director_desk_batch。

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
          const plan = Boolean((preview as { plan?: unknown }).plan);
          return {
            success: true,
            applied: false,
            ...facts,
            evidence: plan
              ? '导演台俯视平面图：剖切高度以上已切除，网格单位为米、边上标有坐标；用它与俯视的布局参考图逐区域对比，再按差异修改'
              : modelSheet
              ? '当前建筑或道具的独立多视角渲染；尺寸来自模型几何，不能替代完整场景中的遮挡、光影和空间核验'
              : sheet
                ? '导演台时间线真实渲染帧拼图；每格标注秒数，不含编辑器 UI，需逐格检查连续性'
                : '导演台当前帧渲染结果；仅代表该时间点与该机位的画面，不含浏览器侧叠加的编辑器 UI',
            __toolAttachments: [{
              type: 'file', mime: previewMime,
              filename: plan ? 'director-plan.jpg' : modelSheet ? `director-model-${preview.entityId}.jpg` : sheet ? 'director-timeline-sheet.jpg' : `director-${Number(preview?.seconds || 0).toFixed(2)}s.png`,
              url: dataUrl,
            }],
          };
        }
        // 命令可能返回 false 表示未生效（例如撤销栈为空），这不算异常，但要如实上报。
        return { success: result !== false, applied: result !== false, result };
      } catch (error) {
        return { ...directorFailure(error), operation };
      }
    },
    // 模型看到的画面必须能落到用户屏幕上，核验才有依据。
    summarizeResult: (result: unknown) => {
      const frames = (result as { __toolAttachments?: Array<{ url?: string }> } | null)?.__toolAttachments;
      if (!frames?.length) return undefined;
      const timesSec = (result as { timesSec?: unknown }).timesSec;
      const cells = (result as { cells?: unknown }).cells;
      const seconds = Number((result as { seconds?: number }).seconds);
      const label = (result as { plan?: unknown }).plan
        ? 'plan'
        : Array.isArray(cells)
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
