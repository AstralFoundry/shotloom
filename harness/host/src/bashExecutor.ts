import Bash from '@deepseek-ai/dsh-bash-sandbox';
import type { ShellExecSpec, ShellExecution } from '@deepseek-ai/dsh-shell';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/** Windows resolves bare bash through System32 before PATH, selecting the WSL shim. */
export default class ProductBash extends Bash {
  protected override executeArgv(
    spec: ShellExecSpec,
    argvOrPrepare: readonly string[] | ((signal: AbortSignal) => Promise<readonly string[]>),
    onStarted?: (process: ShellExecution) => void,
  ): Promise<ShellExecution> {
    if (process.platform !== 'win32') return super.executeArgv(spec, argvOrPrepare, onStarted);
    return super.executeArgv(spec, async signal => {
      const argv = [...(typeof argvOrPrepare === 'function' ? await argvOrPrepare(signal) : argvOrPrepare)];
      const shell = argv.length - 3;
      if (argv[shell] === 'bash' && argv[shell + 1] === '-c') {
        const git = await this.ctx.subprocess.resolveExecutable('git', undefined, signal).catch(() => undefined);
        const bash = git && resolve(dirname(git), '../bin/bash.exe');
        if (bash && await access(bash).then(() => true, () => false)) argv[shell] = bash;
        else argv[shell] = await this.ctx.subprocess.resolveExecutable('bash', undefined, signal);
      }
      return argv;
    }, onStarted);
  }
}
