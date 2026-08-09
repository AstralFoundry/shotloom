import { invoke } from '@tauri-apps/api/core';
import type { JsonObject } from '../core/types';

export type RuntimeDiagnosticSeverity = 'retryable' | 'user_action' | 'reinstall';

export interface RuntimeFailureDiagnosis extends JsonObject {
  code: string;
  title: string;
  message: string;
  primaryAction: string;
  suggestions: string[];
  severity: RuntimeDiagnosticSeverity;
  retryable: boolean;
  evidence: JsonObject;
}

const RULES: Array<{
  code: string;
  pattern: RegExp;
  title: string;
  primaryAction: string;
  suggestions: string[];
  severity?: RuntimeDiagnosticSeverity;
}> = [
  {
    code: 'runtime_circuit_open', pattern: /circuit|熔断|cooldown/i,
    title: 'Agent Runtime 正在恢复保护期', primaryAction: '等待保护期结束后重试',
    suggestions: ['不要连续重复启动 Runtime', '可在诊断信息中查看 circuitOpenUntilMs'],
  },
  {
    code: 'runtime_binary_missing', pattern: /not found|no such file|找不到|缺失.*runtime|sidecar/i,
    title: '本地 Agent Runtime 文件缺失', primaryAction: '重新构建或安装应用',
    suggestions: ['确认 OpenCode sidecar 已随应用打包', '检查安全软件是否隔离了 Runtime 文件'],
    severity: 'reinstall',
  },
  {
    code: 'runtime_port_conflict', pattern: /address.*in use|eaddrinuse|端口.*占用/i,
    title: 'Agent Runtime 端口被占用', primaryAction: '停止占用进程后重试',
    suggestions: ['关闭遗留的 Shotloom 或 OpenCode 进程', '再次启动时会重新分配 Runtime 端口'],
  },
  {
    code: 'runtime_configuration_invalid', pattern: /configuration|config|provider|api.?key|unauthorized|401|403/i,
    title: 'Agent 模型配置不可用', primaryAction: '检查当前模型与 Provider 配置',
    suggestions: ['确认所选模型仍存在', '检查 API Key、Base URL 和模型权限'],
    severity: 'user_action',
  },
  {
    code: 'runtime_resource_exhausted', pattern: /out of memory|enomem|resource exhausted|内存不足|too many open files/i,
    title: '系统资源不足，Agent Runtime 已停止', primaryAction: '释放内存后重试',
    suggestions: ['关闭大型项目或其他高内存应用', '重启 Shotloom 以释放历史缓存'],
    severity: 'user_action',
  },
  {
    code: 'runtime_timeout', pattern: /timeout|timed out|超时|stalled/i,
    title: 'Agent Runtime 响应超时', primaryAction: '确认网络与模型状态后重试',
    suggestions: ['检查 Provider 服务是否可用', '若任务很大，可拆分目标后重试'],
  },
  {
    code: 'runtime_network', pattern: /network|fetch|connect|connection|dns|proxy|网络|连接/i,
    title: 'Agent Runtime 无法连接模型服务', primaryAction: '检查网络或代理后重试',
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

export async function diagnoseRuntimeFailure(cause: unknown): Promise<RuntimeFailureDiagnosis> {
  const raw = cause instanceof Error ? cause.message : String(cause || '未知错误');
  const native: JsonObject = await invoke<JsonObject>('agent_runtime_diagnostics')
    .catch(() => ({} as JsonObject));
  const rule = RULES.find((candidate) => candidate.pattern.test(raw));
  const code = rule?.code || (
    (native?.status as JsonObject | undefined)?.state === 'failed'
      ? 'runtime_crashed'
      : 'runtime_unknown'
  );
  const severity = rule?.severity || 'retryable';
  return {
    code,
    title: rule?.title || 'Agent Runtime 运行失败',
    message: raw.slice(0, 500),
    primaryAction: rule?.primaryAction || '重试；若持续失败，请查看 Runtime 诊断',
    suggestions: rule?.suggestions || ['确认当前项目和模型配置有效', '重启应用后再次尝试'],
    severity,
    retryable: severity !== 'reinstall',
    evidence: {
      generation: Number(native?.generation || 0),
      failureCount: Number(native?.failureCount || 0),
      consecutiveHealthFailures: Number(native?.consecutiveHealthFailures || 0),
      circuitOpenUntilMs: Number(native?.circuitOpenUntilMs || 0),
      lastHealthAtMs: Number(native?.lastHealthAtMs || 0),
      lastProgressAtMs: Number(native?.lastProgressAtMs || 0),
    },
  };
}
