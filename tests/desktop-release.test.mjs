import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { releaseVersion, syncVersion, stageAssets, assembleAssets, targets } from '../scripts/desktop-release.mjs';

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'shotloom-release-'));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('release versions accept stable/prerelease tags and reject unsafe or ambiguous values', () => {
  assert.deepEqual(releaseVersion('v1.2.3'), { version: '1.2.3', tag: 'v1.2.3', prerelease: false });
  assert.deepEqual(releaseVersion('0.8.1'), { version: '0.8.1', tag: '0.8.1', prerelease: false });
  assert.equal(releaseVersion('1.2.3-beta.1').prerelease, true);
  for (const version of ['1.2', 'v01.2.3', '1.2.3-beta.01', '1.2.3+build', '1.2.3\n', '--latest', '../1.2.3']) {
    assert.throws(() => releaseVersion(version));
  }
});

for (const eol of ['\n', '\r\n']) {
test(`tag version synchronizes npm, Tauri and Cargo with ${eol === '\n' ? 'LF' : 'CRLF'} while preserving dependency versions`, () => fixture(async root => {
  await mkdir(join(root, 'src-tauri'));
  await writeFile(join(root, 'package.json'), '{"version":"0.1.0"}');
  await writeFile(join(root, 'package-lock.json'), '{"version":"0.1.0","packages":{"":{"version":"0.1.0"},"dependency":{"version":"9.0.0"}}}');
  await writeFile(join(root, 'src-tauri/tauri.conf.json'), '{"version":"0.1.0"}');
  await writeFile(join(root, 'src-tauri/Cargo.toml'), '[package]\nname = "shotloom"\nversion = "0.1.0"\n[dependencies]\nfoo = "9.0.0"\n'.replaceAll('\n', eol));
  await writeFile(join(root, 'src-tauri/Cargo.lock'), '[[package]]\nname = "foo"\nversion = "9.0.0"\n\n[[package]]\nname = "shotloom"\nversion = "0.1.0"\n'.replaceAll('\n', eol));
  await syncVersion('2.0.0-beta.1', root);
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  assert.equal(lock.version, '2.0.0-beta.1');
  assert.equal(lock.packages[''].version, lock.version);
  assert.equal(lock.packages.dependency.version, '9.0.0');
  assert.equal(JSON.parse(await readFile(join(root, 'src-tauri/tauri.conf.json'), 'utf8')).version, lock.version);
  assert.match(await readFile(join(root, 'src-tauri/Cargo.toml'), 'utf8'), /version = "2.0.0-beta.1"/);
  assert.match((await readFile(join(root, 'src-tauri/Cargo.lock'), 'utf8')).replaceAll('\r\n', '\n'), /name = "foo"\nversion = "9.0.0"[\s\S]*name = "shotloom"\nversion = "2.0.0-beta.1"/);
}));
}

async function staged(root) {
  const directory = join(root, 'assets');
  for (const target of targets) {
    const bundle = join(root, target.platform);
    await mkdir(bundle);
    const updater = join(bundle, `Shotloom${target.updaterExtension}`);
    await writeFile(updater, `${target.platform} application`);
    await writeFile(`${updater}.sig`, 'base64-signature\n');
    if (target.installerExtension !== target.updaterExtension) await writeFile(join(bundle, `Shotloom${target.installerExtension}`), 'installer');
    await stageAssets({ bundle, destination: directory, platform: target.platform, version: '2.0.0' });
  }
  return { directory, version: '2.0.0', repository: 'another-owner/another-repo' };
}

test('release artifacts preserve configured platforms and produce repository-specific updater URLs and checksums', () => fixture(async root => {
  const options = await staged(root);
  const files = await assembleAssets(options);
  const latest = JSON.parse(await readFile(join(options.directory, 'latest.json'), 'utf8'));
  assert.deepEqual(Object.keys(latest.platforms).sort(), targets.map(target => target.platform).sort());
  for (const platform of Object.values(latest.platforms)) {
    assert.equal(platform.signature, 'base64-signature');
    assert.match(platform.url, /^https:\/\/github.com\/another-owner\/another-repo\/releases\/download\/v2.0.0\//);
  }
  assert.equal(new Set(files).size, files.length);
  assert.equal((await readFile(join(options.directory, 'SHA256SUMS'), 'utf8')).trim().split('\n').length, files.length - 1);
}));

test('unprefixed release tags are preserved in updater downloads and release notes', () => fixture(async root => {
  const options = await staged(root);
  await assembleAssets({ ...options, tag: '2.0.0' });
  const latest = JSON.parse(await readFile(join(options.directory, 'latest.json'), 'utf8'));
  for (const platform of Object.values(latest.platforms)) {
    assert.match(platform.url, /\/releases\/download\/2\.0\.0\//);
  }
  assert.match(latest.notes, /\/releases\/tag\/2\.0\.0$/);
  await assert.rejects(assembleAssets({ ...options, tag: '1.0.0' }), /tag and artifact version/);
}));

test('incomplete or corrupted artifacts cannot reach publication', () => fixture(async root => {
  const options = await staged(root);
  const manifestPath = join(options.directory, `${targets[0].platform}.manifest.json`);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const assetPath = join(options.directory, manifest.updater);
  const original = await readFile(assetPath);
  await writeFile(assetPath, 'tampered');
  await assert.rejects(assembleAssets(options), /Corrupt asset/);
  await writeFile(assetPath, original);
  manifest.version = '1.0.0';
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(assembleAssets(options), /stale manifest/);
  await rm(manifestPath);
  await assert.rejects(assembleAssets(options), /Missing platforms/);
}));

test('a missing signature is rejected when staging a platform', () => fixture(async root => {
  const target = targets[0];
  await writeFile(join(root, 'app.app.tar.gz'), 'application');
  await writeFile(join(root, 'app.dmg'), 'installer');
  await assert.rejects(stageAssets({ bundle: root, destination: join(root, 'staged'), platform: target.platform, version: '2.0.0' }), /ENOENT/);
}));

test('staging uses successful Tauri artifacts despite disk images left by a failed attempt', () => fixture(async root => {
  const destination = join(root, 'staged');
  const installer = join(root, 'Shotloom.dmg');
  const updater = join(root, 'Shotloom.app.tar.gz');
  await writeFile(installer, 'final installer');
  await writeFile(updater, 'final updater');
  await writeFile(`${updater}.sig`, 'signature');
  await writeFile(join(root, 'rw.123.Shotloom.dmg'), 'incomplete temporary image');
  const options = { bundle: root, destination, platform: 'darwin-aarch64', version: '0.8.1' };
  await assert.rejects(stageAssets(options), /Expected one installer/);
  const manifest = await stageAssets({ ...options, artifactPaths: [installer, updater, `${updater}.sig`] });
  assert.equal(manifest.assets.length, 3);
  assert.equal(await readFile(join(destination, 'darwin-aarch64-Shotloom.dmg'), 'utf8'), 'final installer');
  assert.ok(manifest.assets.every(asset => !asset.name.includes('rw.123')));
}));
