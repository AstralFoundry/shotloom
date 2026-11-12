/**
 * 导演台命令的结构化失败。
 *
 * `String(error)` 只能给出一句话，Agent 无法据此自愈：revision 冲突要知道当前 revision，
 * 场景被占用要区分是导出、拖动还是路径草稿，参数错误要指出是哪一项。这些信息挂在
 * `hint` 和 `facts` 上，由 host-bridge 原样转给宿主工具，不塞进 message 让模型去解析文本。
 *
 * `code` 是给机器看的稳定标识：中文 message 会随措辞调整，测试和调用方不应该依赖它。
 */
export type DirectorErrorCode =
    | 'INVALID_PARAMS'
    | 'OBJECT_NOT_FOUND'
    | 'LOCKED'
    | 'REVISION_MISMATCH'
    | 'BUSY'
    | 'CANVAS_NOT_READY'
    | 'PATH_INVALID'
    | 'CLIP_INVALID'
    | 'CLIP_OVERLAP'
    | 'UNSUPPORTED_ASSET'
    | 'REFERENCE_MISSING'
    | 'ACTION_FAILED';

export class DirectorCommandError extends Error {
    readonly code: DirectorErrorCode;
    readonly hint?: string;
    readonly facts?: Record<string, unknown>;

    constructor(message: string, options: { code?: DirectorErrorCode; hint?: string; facts?: Record<string, unknown> } = {}) {
        super(message);
        this.name = 'DirectorCommandError';
        this.code = options.code ?? classifyDirectorError(message);
        this.hint = options.hint;
        this.facts = options.facts;
    }
}

/**
 * 从 message 推断错误码。
 *
 * 各个命令原本各自 `throw Error('...')`，几百处措辞不同；先按最具体的模式归类，归不进去的
 * 落到 `INVALID_PARAMS`。新写的代码应当显式传 `code`，这个函数只负责兜住存量。
 */
export function classifyDirectorError(message: string): DirectorErrorCode {
    const text = String(message);
    if (/导演台画布尚未准备好|请先打开 3D 导演台/.test(text)) return 'CANVAS_NOT_READY';
    if (/正在执行其他任务|未提交|请先完成|正在绘制路径|有未提交的拖动/.test(text)) return 'BUSY';
    if (/场景已变化|revision/.test(text)) return 'REVISION_MISMATCH';
    if (/已锁定/.test(text)) return 'LOCKED';
    if (/不存在|未找到/.test(text)) return 'OBJECT_NOT_FOUND';
    if (/没有可调的素材参数|素材不存在|不支持参数/.test(text)) return 'UNSUPPORTED_ASSET';
    if (/没有可比的参考图|参考图加载失败|参考图无法读取/.test(text)) return 'REFERENCE_MISSING';
    if (/路径|points|timeSec|from 与 to/.test(text)) return 'PATH_INVALID';
    if (/片段|clip|动作速度|结束时间/.test(text)) return 'CLIP_INVALID';
    return 'INVALID_PARAMS';
}
