import { ipcMain, type WebContents } from 'electron';
import { errorMessage } from '../core/errors';

/**
 * 命令注册表：通道名与参数形状完全沿用 Tauri 的 `invoke` 契约，
 * 渲染进程的 `command()` 映射表不需要改写。
 */
export type CommandArgs = Record<string, unknown>;
export type CommandHandler = (args: CommandArgs) => unknown | Promise<unknown>;

const handlers = new Map<string, CommandHandler>();

export function defineCommand(name: string, handler: CommandHandler): void {
  if (handlers.has(name)) throw new Error(`duplicate command handler: ${name}`);
  handlers.set(name, handler);
}

export function registeredCommands(): string[] {
  return [...handlers.keys()];
}

function toError(error: unknown): unknown {
  const message = errorMessage(error);
  try {
    JSON.parse(message);
    return message;
  } catch {
    return message;
  }
}

export function registerCommandChannel(): void {
  ipcMain.handle('shotloom:command', async (_event, command: unknown, args: unknown) => {
    const name = String(command ?? '');
    const handler = handlers.get(name);
    if (!handler) return { ok: false, error: `Unknown desktop command: ${name}` };
    try {
      const value = await handler(args && typeof args === 'object' ? args as CommandArgs : {});
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: toError(error) };
    }
  });
}

export function emitEvent(contents: WebContents, name: string, payload: unknown): void {
  if (contents.isDestroyed()) return;
  contents.send(`shotloom:event:${name}`, payload);
}

export function emitChannel(contents: WebContents, id: string, payload: unknown): void {
  if (contents.isDestroyed()) return;
  contents.send('shotloom:channel', { id, payload });
}
