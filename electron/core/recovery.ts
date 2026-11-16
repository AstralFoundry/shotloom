import { app, BrowserWindow } from 'electron';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { withDatabase } from './db';
import { appDataFile } from './paths';
import { loadRecovery, saveRecovery } from './storage';
import { emitEvent } from '../ipc/registry';

/**
 * 运行时恢复日志：进程异常退出后，下次启动才知道上一轮发生过什么。
 * 30 秒心跳同时观察可用内存，低内存时向渲染进程发 system-memory-pressure。
 */

export interface RecoveryJournal {
  schemaVersion: number;
  sessionId: string;
  cleanExit: boolean;
  startedAt: string;
  heartbeatAt: string;
  pid: number;
  appVersion: string;
  runtimeState: string;
  activeRunId: string;
  activeProjectKey: string;
  rssKb: number | null;
  availableMemoryKb: number | null;
  lastError: string;
}

const RECOVERY_SCHEMA_VERSION = 1;
const JOURNAL_FILE = 'runtime';
const PREVIOUS_FILE = 'previous-unclean-exit';

let current: RecoveryJournal = emptyJournal();
let previousUnclean: RecoveryJournal | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let lowMemoryPolls = 0;
let lastPressureEmitMs = 0;

function emptyJournal(): RecoveryJournal {
  return {
    schemaVersion: RECOVERY_SCHEMA_VERSION, sessionId: '', cleanExit: false, startedAt: '', heartbeatAt: '',
    pid: 0, appVersion: '', runtimeState: 'stopped', activeRunId: '', activeProjectKey: '',
    rssKb: null, availableMemoryKb: null, lastError: '',
  };
}

function processRssKb(): number | null {
  return Math.round(process.memoryUsage().rss / 1024);
}

/** macOS 的 vm_stat / Linux 的 /proc/meminfo：与 Rust 侧取同一组可用内存口径。 */
function availableMemoryKb(): number | null {
  try {
    if (process.platform === 'darwin') {
      const text = execFileSync('vm_stat', { encoding: 'utf8' });
      const pageSize = Number(/page size of (\d+)/.exec(text)?.[1] ?? 0);
      if (!pageSize) return null;
      let pages = 0;
      for (const prefix of ['Pages free:', 'Pages inactive:', 'Pages speculative:']) {
        const line = text.split('\n').find(item => item.trim().startsWith(prefix));
        const value = Number(line?.trim().slice(prefix.length).trim().replace(/\.$/, ''));
        if (Number.isFinite(value)) pages += value;
      }
      return Math.round((pages * pageSize) / 1024);
    }
    if (process.platform === 'linux') {
      const text = readFileSync('/proc/meminfo', 'utf8');
      const line = text.split('\n').find(item => item.startsWith('MemAvailable:'));
      const value = Number(line?.slice('MemAvailable:'.length).trim().split(/\s+/)[0]);
      return Number.isFinite(value) ? value : null;
    }
  } catch {
    return null;
  }
  return null;
}

function persist(journal: RecoveryJournal): void {
  withDatabase(appDataFile('app.sqlite'), db => { saveRecovery(db, JOURNAL_FILE, journal); });
}

function readJournal(path: string): RecoveryJournal | null {
  try {
    const value = withDatabase(appDataFile('app.sqlite'), db => loadRecovery(db, path));
    return value && typeof value === 'object' ? value as RecoveryJournal : null;
  } catch {
    return null;
  }
}

export function initializeRecovery(): void {
  const previous = readJournal(JOURNAL_FILE);
  if (previous && !previous.cleanExit) {
    previousUnclean = previous;
    withDatabase(appDataFile('app.sqlite'), db => { saveRecovery(db, PREVIOUS_FILE, previous); });
  }
  const now = String(Date.now());
  current = {
    ...emptyJournal(),
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    sessionId: `${process.pid}-${now}`,
    startedAt: now,
    heartbeatAt: now,
    pid: process.pid,
    appVersion: app.getVersion(),
    rssKb: processRssKb(),
    availableMemoryKb: availableMemoryKb(),
  };
  persist(current);
  startHeartbeat();
}

export function stopRecovery(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function broadcast(name: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) emitEvent(window.webContents, name, payload);
}

function startHeartbeat(): void {
  heartbeatTimer ??= setInterval(() => {
    if (current.cleanExit) {
      stopRecovery();
      return;
    }
    current.heartbeatAt = String(Date.now());
    current.rssKb = processRssKb();
    current.availableMemoryKb = availableMemoryKb();
    try {
      persist(current);
    } catch (error) {
      console.error('[recovery] heartbeat persistence failed', error);
    }
    const availableKb = current.availableMemoryKb ?? Number.MAX_SAFE_INTEGER;
    const low = availableKb < 1_048_576;
    const critical = availableKb < 524_288;
    lowMemoryPolls = low ? lowMemoryPolls + 1 : 0;
    const required = critical ? 1 : 3;
    if (lowMemoryPolls < required) return;
    const cooldown = critical ? 120_000 : 600_000;
    const now = Date.now();
    if (now - lastPressureEmitMs < cooldown) return;
    lastPressureEmitMs = now;
    lowMemoryPolls = 0;
    broadcast('system-memory-pressure', {
      level: critical ? 'critical' : 'low',
      availableMemoryKb: availableKb,
      rssKb: current.rssKb,
    });
  }, 30_000);
  heartbeatTimer.unref?.();
}

export function markCleanExit(): void {
  current.cleanExit = true;
  current.heartbeatAt = String(Date.now());
  try {
    persist(current);
  } catch (error) {
    console.error('[recovery] clean exit persistence failed', error);
  }
  stopRecovery();
}

export function recoveryStatus(): { current: RecoveryJournal; previousUnclean: RecoveryJournal | null } {
  return { current, previousUnclean };
}

export function updateRecoveryActivity(args: {
  runtimeState?: unknown; activeRunId?: unknown; activeProjectKey?: unknown; lastError?: unknown;
}): void {
  if (typeof args.runtimeState === 'string') current.runtimeState = args.runtimeState;
  if (typeof args.activeRunId === 'string') current.activeRunId = args.activeRunId;
  if (typeof args.activeProjectKey === 'string') current.activeProjectKey = args.activeProjectKey;
  if (typeof args.lastError === 'string') current.lastError = args.lastError;
  current.heartbeatAt = String(Date.now());
  persist(current);
}
