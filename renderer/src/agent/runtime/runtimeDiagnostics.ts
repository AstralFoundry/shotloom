import type { JsonObject } from '../core/types';

/**
 * Agent 运行失败分类。
 *
 * 失败只有两个来源：模型请求（协议能力、配置、网络、超时）和本地运行环境。
 * 分类依据是服务端或运行入口真实报出的错误文本，不猜测用户意图。
 */

export interface RuntimeFailureDiagnosis extends JsonObject {
  code: string;
  title: string;
  message: string;
  primaryAction: string;
  suggestions: string[];
}

const RULES: Array<{
  code: string;
  pattern: RegExp;
  title: string;
  primaryAction: string;
  suggestions: string[];
}> = [
  {
    code: 'agent_model_unsupported',
    pattern: /协议不是|未声明支持|运行时契约|(?:未|不)在模型目录中|not in (the )?model catalog/i,
    title: '当前模型无法驱动 Agent',
    primaryAction: '改用支持工具调用的 Chat Completions 模型',
    suggestions: ['在模型目录里确认该模型的 Agent 协议', '自研 Agent Loop 只实现 OpenAI Chat Completions，不会降级成其他协议'],
  },
  {
    code: 'agent_model_configuration',
    pattern: /configuration|config|provider|api.?key|unauthorized|forbidden|401|403|未配置|停用/i,
    title: 'Agent 模型配置不可用',
    primaryAction: '检查当前模型与 Provider 配置',
    suggestions: ['确认所选模型仍存在且未被停用', '检查 API Key、Base URL 和模型权限'],
  },
  {
    code: 'agent_resource_exhausted',
    pattern: /out of memory|enomem|resource exhausted|内存不足|too many open files/i,
    title: '系统资源不足，Agent 已停止',
    primaryAction: '释放内存后重试',
    suggestions: ['关闭大型项目或其他高内存应用', '重启 Shotloom 以释放历史缓存'],
  },
  {
    code: 'agent_model_timeout',
    pattern: /timeout|timed out|超时|deadline exceeded/i,
    title: '模型响应超时',
    primaryAction: '确认网络与模型状态后重试',
    suggestions: ['检查 Provider 服务是否可用', '若任务很大，可拆分目标后重试'],
  },
  {
    code: 'agent_model_network',
    pattern: /network|fetch|connect|connection|dns|proxy|econn|socket|网络|连接/i,
    title: '无法连接模型服务',
    primaryAction: '检查网络或代理后重试',
    suggestions: ['确认系统代理配置正确', '检查 Provider Base URL 是否可访问'],
  },
];

export class RuntimeDiagnosticError extends Error {
  readonly diagnosis: RuntimeFailureDiagnosis;

  constructor(diagnosis: RuntimeFailureDiagnosis) {
    super(diagnosis.message);
    this.name = 'RuntimeDiagnosticError';
    this.diagnosis = diagnosis;
  }
}

export function diagnoseRuntimeFailure(cause: unknown): RuntimeFailureDiagnosis {
  const raw = cause instanceof Error ? cause.message : String(cause || '未知错误');
  const rule = RULES.find((candidate) => candidate.pattern.test(raw));
  return {
    code: rule?.code || 'agent_failed',
    title: rule?.title || 'Agent 运行失败',
    message: raw.slice(0, 500),
    primaryAction: rule?.primaryAction || '重试本轮任务',
    suggestions: rule?.suggestions || ['根据诊断码检查模型与网络配置后重试'],
  };
}
