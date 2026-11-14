import { before, after, test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
let server;
let url;

before(async () => {
    server = await createServer({
        root,
        server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false },
    });
    await server.listen();
    url = `http://127.0.0.1:${server.httpServer.address().port}`;
});

after(async () => { await server?.close(); });

for (const [name, script] of [
    ['agent production, export recovery and delivery package', 'smoke-agent-production.mjs'],
    ['editor workflows and recovery', 'smoke.mjs'],
    ['timeline controls and responsive layout', 'smoke-timeline.mjs'],
    ['GPU depth across camera distances', 'smoke-depth.mjs'],
]) {
    test(name, { timeout: 180_000 }, async () => {
        try {
            const { stdout } = await run(process.execPath, [`scripts/${script}`], {
                cwd: root,
                env: { ...process.env, DIRECTOR_URL: url },
                timeout: 170_000,
                maxBuffer: 8 * 1024 * 1024,
            });
            console.log(stdout.trim());
        } catch (error) {
            throw new Error(`${script} failed:\n${error.stdout ?? ''}\n${error.stderr ?? ''}`, { cause: error });
        }
    });
}
