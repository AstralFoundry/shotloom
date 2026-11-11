import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readShotloomConfig } from './shotloom-config.mjs';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const destination = join(rootDir, 'renderer', 'src', 'config', 'shotloom-defaults.generated.json');
const { defaults } = readShotloomConfig();
const generated = `${JSON.stringify({
  models: defaults.models,
  project: defaults.project,
  appSettings: {
    agentAutoEval: defaults.agent.autoEval,
    agentAutoLayout: defaults.agent.autoLayout,
    layoutAlgorithm: defaults.canvas.layoutAlgorithm,
    modelPollIntervalMs: defaults.generation.pollIntervalMs,
    runtimeProtection: defaults.runtimeProtection,
  },
}, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (readFileSync(destination, 'utf8') !== generated) {
    throw new Error('shotloom-defaults.generated.json is stale; run npm run config:generate');
  }
} else {
  writeFileSync(destination, generated);
}
