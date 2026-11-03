import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDesktopHost } from './desktopHost.js';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const contentRoot = process.env.SHOTLOOM_CONTENT_ROOT;
const rulesPath = process.env.SHOTLOOM_RULES_PATH;
const dataRoot = process.env.SHOTLOOM_DATA_ROOT;
const bridgeUrl = process.env.SHOTLOOM_BRIDGE_URL;
const token = process.env.SHOTLOOM_BRIDGE_TOKEN;
if (!contentRoot || !rulesPath || !dataRoot || !bridgeUrl || !token) throw new Error('Missing Shotloom desktop Host configuration');
const { host, origin } = await startDesktopHost({
  dataRoot, contentRoot, rulesPath, distIndex: join(packageRoot, 'client-dist/index.html'),
  bridge: { url: bridgeUrl, token, authorize: true },
});
process.stdout.write(`shotloom host: ${origin}\n`);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await host.dispose();
  process.exit(0);
}
process.on('SIGTERM', () => { void close(); });
process.on('SIGINT', () => { void close(); });

// A parent crash closes the native pipe too, so Host ownership cannot leak.
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { if (String(chunk).trim() === 'shutdown') void close(); });
process.stdin.on('end', () => { void close(); });
