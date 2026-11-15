const messages = {
  "zh-CN": {
    "runningHub.missingWorkflow": "RunningHub 模型目录缺少所选比例或分辨率的工作流映射",
    "runningHub.promptRequired": "RunningHub MiniMax H3 纯文本生成必须提供提示词",
    "task.failed": "任务失败",
    "runningHub.missingVideo": "任务完成但未返回 MP4 视频",
    "runningHub.invalidDuration": "RunningHub MiniMax H3 时长必须为目录声明的 {durations} 秒",
    "runningHub.tooManyInputs": "RunningHub {kind} 超过模型目录上限 {max}",
    "runningHub.queryFailed": "任务查询失败"
  },
  "en-US": {
    "runningHub.missingWorkflow": "The RunningHub model catalog has no workflow mapping for the selected aspect ratio or resolution.",
    "runningHub.promptRequired": "RunningHub MiniMax H3 text-only generation requires a prompt.",
    "task.failed": "Task failed",
    "runningHub.missingVideo": "The task completed without returning an MP4 video.",
    "runningHub.invalidDuration": "RunningHub MiniMax H3 duration must match the catalog: {durations} seconds.",
    "runningHub.tooManyInputs": "RunningHub {kind} exceeds the model catalog limit of {max}.",
    "runningHub.queryFailed": "Failed to query the task."
  }
};
export const createTranslator = (locale = 'zh-CN') => (key, args = {}) => (messages[locale]?.[key] || messages['zh-CN'][key] || key).replace(/\{([^}]+)\}/g, (_, name) => String(args[name] ?? ''));
export const t = createTranslator();
