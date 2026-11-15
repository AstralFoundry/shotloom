import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareMobileRelease } from '../scripts/mobile-release.mjs';
import { readSource } from './helpers/sourceContract.mjs';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('mobile release synchronizes versions and permits only an HTTPS cloud origin', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shotloom-mobile-'));
  try {
    await writeFile(join(directory, 'tauri.conf.json'), readSource('mobile/src-tauri/tauri.conf.json'));
    await writeFile(join(directory, 'Cargo.toml'), readSource('mobile/src-tauri/Cargo.toml'));
    await writeFile(join(directory, 'Cargo.lock'), '[[package]]\nname = "shotloom-mobile"\nversion = "0.9.1"\n');
    for (const origin of ['http://example.com', 'https://user:password@example.com', 'https://example.com/path', 'https://example.com?x=1', 'https://example.com#fragment']) {
      await assert.rejects(prepareMobileRelease({ directory, tag: 'v1.2.3', origin }), /HTTPS origin/);
    }
    await prepareMobileRelease({ directory, tag: 'v1.2.3-beta.1', origin: 'https://cloud.example.com/' });
    const config = JSON.parse(await readFile(join(directory, 'tauri.conf.json'), 'utf8'));
    assert.equal(config.version, '1.2.3-beta.1');
    assert.equal(config.build.frontendDist, 'https://cloud.example.com');
    assert.equal(config.app.windows[0].url, config.build.frontendDist);
    assert.deepEqual(config.app.security.capabilities, []);
    for (const file of ['Cargo.toml', 'Cargo.lock']) assert.match(await readFile(join(directory, file), 'utf8'), /version = "1.2.3-beta.1"/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the mobile shell uses browser media despite Tauri internals being present', async () => {
  const env = await createRendererEnv({ storage: new Map(), withWindow: true, storageMode: 'cloud' });
  try {
    window.__TAURI_INTERNALS__ = {};
    window.__SHOTLOOM_MOBILE__ = true;
    const { desktopApi } = await env.load('services/desktopApi');
    assert.equal(desktopApi.platform, 'browser');
    assert.equal(desktopApi.nativeMedia, undefined);
    assert.equal((await desktopApi.update.check()).hasUpdate, false);
  } finally {
    await env.dispose();
  }
});
