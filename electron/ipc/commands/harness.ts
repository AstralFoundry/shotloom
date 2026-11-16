import { defineCommand } from '../registry';
import type { CommandArgs } from '../registry';
import {
  bindHarnessSession, harnessBridgeStatus, harnessStatus, harnessTransport, respondHarnessTool,
  restartHarnessRuntime, setHarnessSessionsArchived, startHarnessRuntime, stopHarnessRuntime,
} from '../../core/harness';

/**
 * Harness 通道：运行时生命周期、会话绑定、会话归档、工具请求回执与 transport 透传。
 * 只有主窗口（webContents 存在）能调用这些通道；没有对外 HTTP 入口。
 */

function optionsOf(args: CommandArgs): { sourceRoot?: string; dataRoot?: string } {
  const options = args.options;
  if (!options || typeof options !== 'object') return {};
  const value = options as Record<string, unknown>;
  return {
    ...(typeof value.sourceRoot === 'string' && value.sourceRoot ? { sourceRoot: value.sourceRoot } : {}),
    ...(typeof value.dataRoot === 'string' && value.dataRoot ? { dataRoot: value.dataRoot } : {}),
  };
}

defineCommand('harness_runtime_status', () => harnessStatus());

defineCommand('start_harness_runtime', (args) => startHarnessRuntime(optionsOf(args)));

defineCommand('stop_harness_runtime', () => stopHarnessRuntime());

defineCommand('restart_harness_runtime', (args) => restartHarnessRuntime(optionsOf(args)));

defineCommand('harness_bridge_status', () => harnessBridgeStatus());

defineCommand('harness_bind_session', (args) => {
  const config = args.config;
  if (!config || typeof config !== 'object') throw new Error('missing harness session config');
  return bindHarnessSession(config as Record<string, unknown>);
});

defineCommand('harness_set_sessions_archived', (args) => {
  const projectKey = String(args.projectKey ?? '');
  const sessionIds = Array.isArray(args.sessionIds) ? args.sessionIds.map(String) : null;
  return setHarnessSessionsArchived(projectKey, sessionIds, Boolean(args.archived));
});

defineCommand('harness_transport', (args) => {
  const message = args.message;
  const channel = args.channel;
  const channelId = channel && typeof channel === 'object'
    ? String((channel as Record<string, unknown>).__shotloomChannelId ?? '')
    : '';
  if (!message || typeof message !== 'object') throw new Error('Missing transport message');
  if (!channelId) throw new Error('Missing transport channel');
  harnessTransport(message as Record<string, unknown>, channelId);
  return null;
});

defineCommand('harness_tool_respond', (args) => {
  const response = args.response;
  if (!response || typeof response !== 'object') throw new Error('missing tool response');
  respondHarnessTool(response as Record<string, unknown>);
  return null;
});
