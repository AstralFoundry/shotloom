import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readShotloomConfig, tauriBuildOverride, tauriDevOverride } from './shotloom-config.mjs';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const [command, ...args] = process.argv.slice(2);
const config = command === 'dev' || command === 'build' ? readShotloomConfig() : null;
const override = command === 'dev' ? tauriDevOverride(config)
  : command === 'build' ? tauriBuildOverride(config) : null;
const result = spawnSync(process.execPath, [
  join(rootDir, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'),
  ...(command ? [command] : []),
  ...(override ? ['--config', override] : []),
  ...(command === 'dev' && config.development.verbose ? ['--verbose'] : []),
  ...args,
], { cwd: rootDir, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.signal) process.kill(process.pid, result.signal);
process.exitCode = result.status ?? 1;
