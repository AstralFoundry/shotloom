import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { releaseVersion, syncVersion, stageAssets, assembleAssets, targets } from '../scripts/desktop-release.mjs';

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'shotloom-release-'));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

const sha256 = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');

test('release versions accept stable/prerelease tags and reject unsafe or ambiguous values', () => {
  assert.deepEqual(releaseVersion('v1.2.3'), { version: '1.2.3', tag: 'v1.2.3', prerelease: false });
  assert.deepEqual(releaseVersion('0.8.1'), { version: '0.8.1', tag: '0.8.1', prerelease: false });
  assert.equal(releaseVersion('1.2.3-beta.1').prerelease, true);
  assert.deepEqual(releaseVersion('0.9.2-test20261117'), { version: '0.9.2-test20261117', tag: '0.9.2-test20261117', prerelease: true });
  for (const version of ['1.2', 'v01.2.3', '1.2.3-beta.01', '1.2.3+build', '1.2.3\n', '--latest', '../1.2.3']) {
    assert.throws(() => releaseVersion(version));
  }
});

for (const eol of ['\n', '\r\n']) {
  test(`tag version synchronizes npm manifests with ${eol === '\n' ? 'LF' : 'CRLF'} while preserving dependency versions`, () => fixture(async root => {
    await writeFile(join(root, 'package.json'), `{"version":"0.1.0"}${eol}`);
    await writeFile(join(root, 'package-lock.json'), `{"version":"0.1.0","packages":{"":{"version":"0.1.0"},"dependency":{"version":"9.0.0"}}}${eol}`);
    await syncVersion('2.0.0-beta.1', root);
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
    assert.equal(manifest.version, '2.0.0-beta.1');
    assert.equal(lock.version, '2.0.0-beta.1');
    assert.equal(lock.packages[''].version, lock.version);
    assert.equal(lock.packages.dependency.version, '9.0.0');
  }));
}

function artifactNames(target, version = '2.0.0') {
  const mac = target.platform === 'darwin-aarch64';
  return {
    installer: `Shotloom-${version}-${mac ? 'mac-arm64' : 'win-x64'}${target.installerExtension}`,
    updater: `Shotloom-${version}-${mac ? 'mac-arm64' : 'win-x64'}${target.updaterExtensions[0]}`,
    metadata: target.metadataFiles[0],
  };
}

async function stagePlatform(root, directory, target, version = '2.0.0') {
  const bundle = join(root, target.platform);
  await mkdir(bundle, { recursive: true });
  const names = artifactNames(target, version);
  await writeFile(join(bundle, names.installer), `${target.platform} installer`);
  if (names.updater !== names.installer) await writeFile(join(bundle, names.updater), `${target.platform} updater`);
  await writeFile(join(bundle, `${names.updater}.blockmap`), 'blockmap');
  await writeFile(join(bundle, names.metadata), `version: ${version}\nfiles:\n  - url: ${names.updater}\n`);
  return stageAssets({ bundle, destination: directory, platform: target.platform, version });
}

test('electron-builder artifacts stage per platform with update metadata and checksums', () => fixture(async root => {
  const directory = join(root, 'assets');
  const manifests = [];
  for (const target of targets) manifests.push(await stagePlatform(root, directory, target));
  assert.deepEqual(manifests.map(item => item.platform).sort(), targets.map(item => item.platform).sort());
  for (const target of targets) {
    const files = new Set([...target.metadataFiles, artifactNames(target).installer, artifactNames(target).updater, `${artifactNames(target).updater}.blockmap`]);
    for (const name of files) assert.ok(await readFile(join(directory, name)));
  }
  const staged = await assembleAssets({ directory, version: '2.0.0' });
  const sums = await readFile(join(directory, 'SHA256SUMS'), 'utf8');
  for (const line of sums.trim().split('\n')) {
    const [digest, name] = line.split(/\s{2}/);
    assert.equal(await sha256(join(directory, name)), digest, name);
  }
  assert.ok(staged.every(file => !file.includes('.manifest.json')));
}));

test('Windows staging excludes executables and metadata inside the unpacked application', () => fixture(async root => {
  const target = targets.find(item => item.platform === 'windows-x86_64');
  const bundle = join(root, target.platform);
  const payload = join(bundle, 'win-unpacked', 'resources');
  await mkdir(payload, { recursive: true });
  for (const name of ['Shotloom.exe', 'ffmpeg.exe', 'node.exe', 'latest.yml', 'node.exe.blockmap']) {
    await writeFile(join(payload, name), 'application payload');
  }
  const directory = join(root, 'assets');
  const manifest = await stagePlatform(root, directory, target);
  const names = artifactNames(target);
  assert.equal(manifest.installer, names.installer);
  assert.equal(manifest.updater, names.updater);
  assert.deepEqual(manifest.assets.map(asset => asset.name).sort(), [
    names.installer, names.metadata, `${names.updater}.blockmap`,
  ].sort());
  for (const asset of manifest.assets) {
    assert.equal(await sha256(join(directory, asset.name)), asset.sha256);
  }
}));

test('stage rejects missing update metadata and a version that does not match the tag', () => fixture(async root => {
  const target = targets[0];
  const bundle = join(root, 'bundle');
  await mkdir(bundle);
  const names = artifactNames(target);
  await writeFile(join(bundle, names.installer), 'installer');
  await writeFile(join(bundle, names.updater), 'updater');
  await assert.rejects(stageAssets({ bundle, destination: join(root, 'assets'), platform: target.platform, version: '2.0.0' }), /Missing update metadata/);
  await writeFile(join(bundle, names.metadata), 'version: 1.0.0\n');
  await assert.rejects(stageAssets({ bundle, destination: join(root, 'assets'), platform: target.platform, version: '2.0.0' }), /does not describe 2\.0\.0/);
  await writeFile(join(bundle, names.metadata), 'version: 2.0.0\n');
  await stageAssets({ bundle, destination: join(root, 'assets'), platform: target.platform, version: '2.0.0' });
})).catch(() => undefined);

test('assemble refuses missing platforms, duplicates and corrupt assets', () => fixture(async root => {
  const directory = join(root, 'assets');
  for (const target of targets) await stagePlatform(root, directory, target);
  await assert.rejects(assembleAssets({ directory, version: '2.0.0', tag: 'v3.0.0' }), /tag and artifact version/);
  const corrupt = join(directory, artifactNames(targets[0]).installer);
  await writeFile(corrupt, 'tampered bytes');
  await assert.rejects(assembleAssets({ directory, version: '2.0.0' }), /Corrupt asset/);
}));
