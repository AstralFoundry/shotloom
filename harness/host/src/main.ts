import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDesktopHost } from './desktopHost.js';
import { nativeTransport } from './nativeTransport.js';
import { createInterface } from 'node:readline';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const contentRoot = process.env.SHOTLOOM_CONTENT_ROOT;
const rulesPath = process.env.SHOTLOOM_RULES_PATH;
const dataRoot = process.env.SHOTLOOM_DATA_ROOT;
const bridgeUrl = process.env.SHOTLOOM_BRIDGE_URL;
const token = process.env.SHOTLOOM_BRIDGE_TOKEN;
if (!contentRoot || !rulesPath || !dataRoot || !bridgeUrl || !token) throw new Error('Missing Shotloom desktop Host configuration');
const desktop = await startDesktopHost({
  dataRoot, contentRoot, rulesPath, distIndex: join(packageRoot, 'client-dist/index.html'),
  bridge: { url: bridgeUrl, token, authorize: true },
});
const { host } = desktop;
const receive = nativeTransport(desktop, message => process.stdout.write(`shotloom transport: ${JSON.stringify(message)}\n`));
process.stdout.write('shotloom host: native\n');
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
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  if (line === 'shutdown') { void close(); return; }
  try { void receive(JSON.parse(line)); } catch { process.stderr.write('Invalid native transport message\n'); }
});
input.on('close', () => { void close(); });
