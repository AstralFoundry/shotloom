import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { defineCommand } from '../registry';

/**
 * 桌面 E2E 验证钩子：测试驱动先激活窗口，再由这里截取当前可见画面。
 * 只在 macOS 上可用（screencapture）；其他平台明确失败，而不是返回空图。
 */

defineCommand('capture_agent_e2e_screen', (args) => {
  if (process.platform !== 'darwin') {
    throw new Error('Agent E2E screenshot is only available on macOS');
  }
  const target = typeof args.path === 'string' && args.path ? args.path : join(tmpdir(), 'shotloom-agent-e2e.png');
  mkdirSync(dirname(target), { recursive: true });
  const result = spawnSync('screencapture', ['-x', '-o', target], { stdio: 'ignore' });
  if (result.error) throw new Error(`启动 screencapture 失败：${result.error.message}`);
  if (result.status !== 0) throw new Error(`screencapture 退出码 ${result.status}`);
  return { path: target, width: null, height: null };
});
