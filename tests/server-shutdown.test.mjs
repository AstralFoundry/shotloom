import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

test('production shutdown lets an in-flight model stream finish before exiting', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(fileURLToPath(new URL('../server/.shutdown-test-', import.meta.url)));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const entry = fileURLToPath(new URL('../server/src/index.ts', import.meta.url));
  const outfile = join(directory, 'server.mjs');
  await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external',
    banner: { js: "process.on('message', () => process.emit('SIGTERM'));" },
    plugins: [{ name: 'shutdown-boundaries', setup(builder) {
      builder.onResolve({ filter: /^\.\// }, args => args.importer === entry ? { path: args.path, namespace: 'probe' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'probe' }, ({ path }) => ({ contents: {
        './env': `export const env={NODE_ENV:'production',PORT:0,FRONTEND_URL:'http://localhost'};`,
        './site': `import {Hono} from 'hono';export const createSiteApp=()=>new Hono();`,
        './auth': `import {Hono} from 'hono';export const authApp=new Hono(),nativeRelaySession=()=>false;`,
        './lib/nativeAuth': `export const nativeSession=()=>false;`,
        './lib/requestMetrics': `export const requestMetrics=async(c,next)=>next();`,
        './lib/errors': `export class HttpError extends Error{}`,
        './lib/respond': `export const envelope=data=>({data});`,
        './agent': `import {Hono} from 'hono';import {stream} from 'hono/streaming';
          export const agentApp=new Hono().get('/model',c=>stream(c,async output=>{
            await output.writeln(JSON.stringify({version:1,chunk:{type:'text-delta',text:'started'}}));
            await new Promise(resolve=>setTimeout(resolve,300));
            await output.writeln(JSON.stringify({version:1,done:true}));
          }));`,
      }[path] ?? `import {Hono} from 'hono';export const ${path.slice(2)}App=new Hono();`, loader: 'js', resolveDir: fileURLToPath(new URL('../server/', import.meta.url)) }));
    } }],
  });
  const child = fork(outfile, { silent: true });
  const exited = once(child, 'exit');
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const port = await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', data => { output += data; const match = output.match(/localhost:(\d+)/); if (match) resolve(match[1]); });
    child.stderr.on('data', data => reject(new Error(String(data))));
    child.once('exit', code => reject(new Error('Server exited before listening: ' + code)));
  });
  const response = await fetch(`http://127.0.0.1:${port}/api/agent/model`);
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /started/);
  child.send('shutdown');
  let remaining = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    remaining += new TextDecoder().decode(value);
  }
  assert.match(remaining, /"done":true/);
  assert.deepEqual(await exited, [0, null]);
});
