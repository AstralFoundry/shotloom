// One trusted provider invocation per process. stdout is reserved for its JSON reply.
import { pathToFileURL } from 'node:url';
for (const name of ['log', 'info', 'warn', 'debug', 'error']) console[name] = () => {};
let body = '';
for await (const chunk of process.stdin) body += chunk;
try {
  const { input, config } = JSON.parse(body);
  const exports = await import(pathToFileURL(process.argv[1]).href);
  const method = process.argv[2];
  const implementation = exports[method] ?? exports.default?.[method];
  if (typeof implementation !== 'function') throw new Error(`Plugin does not implement ${method}`);
  const result = await implementation(input, { config: config || {}, signal: new AbortController().signal });
  process.stdout.write(JSON.stringify({ result: result ?? null }));
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}
