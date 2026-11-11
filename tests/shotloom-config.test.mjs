import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readShotloomConfig, tauriBuildOverride, tauriDevOverride } from '../scripts/shotloom-config.mjs';

const yaml = (port = 5188) => `version: 1
development:
  webHost: 127.0.0.1
  webPort: ${port}
  openBrowser: false
  verbose: true
desktop:
  mainWindow:
    title: Shotloom Test
    width: 1200
    height: 800
    minWidth: 1000
    minHeight: 700
defaults:
  models:
    text: gpt-6-astra
    image: gpt-image-2.6-sunburst
    video: grok-imagine-video-1.5
  project:
    autoSave: false
  agent:
    autoEval: false
    autoLayout: true
  canvas:
    layoutAlgorithm: elk-layered
  generation:
    pollIntervalMs: 2100
  runtimeProtection:
    healthIntervalMs: 10000
    failureThreshold: 3
    failureWindowMs: 300000
    circuitCooldownMs: 120000
    stallWarningMs: 180000
    hardCapMs: 1800000
`;

test('YAML supplies the shared development URL and application defaults', () => {
  const directory = mkdtempSync(join(tmpdir(), 'shotloom-config-'));
  const path = join(directory, 'shotloom.yml');
  try {
    writeFileSync(path, yaml());
    const config = readShotloomConfig(path);
    assert.equal(config.development.webPort, 5188);
    assert.equal(config.development.verbose, true);
    assert.equal(config.defaults.project.autoSave, false);
    assert.equal(config.defaults.agent.autoEval, false);
    assert.equal(config.defaults.generation.pollIntervalMs, 2100);
    const devOverride = JSON.parse(tauriDevOverride(config));
    assert.equal(devOverride.build.devUrl, 'http://127.0.0.1:5188');
    assert.equal(devOverride.app.windows[0].width, 1200);
    assert.equal(devOverride.app.windows[0].title, 'Shotloom Test');
    assert.equal(JSON.parse(tauriBuildOverride(config)).build, undefined);
    writeFileSync(path, yaml(0));
    assert.throws(() => readShotloomConfig(path), /development\.webPort/);
    writeFileSync(path, yaml().replace('webPort: 5188', 'webPort: 5188\n  webPort: 5199'));
    assert.throws(() => readShotloomConfig(path), /webPort/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
