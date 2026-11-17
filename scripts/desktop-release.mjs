import { readFile, writeFile, readdir, mkdir, copyFile, appendFile, stat } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
export const targets = await readJson(join(root, 'scripts/release-targets.json'));

export function releaseVersion(value) {
  const version = value.replace(/^v/, '');
  if (version.trim() !== version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/.test(version)) {
    throw new Error('Expected a semantic version such as v1.2.3 or v1.2.3-beta.1 (without build metadata)');
  }
  return { version, tag: value, prerelease: version.includes('-') };
}

// Only build-workspace files change in CI. The tag is the release source of truth.
export async function syncVersion(version, directory = root) {
  for (const relative of ['package.json', 'package-lock.json']) {
    const file = join(directory, relative), data = await readJson(file);
    data.version = version;
    if (relative === 'package-lock.json') data.packages[''].version = version;
    await writeJson(file, data);
  }
}

async function bundleFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  // Unpacked application directories contain executables, not release installers.
  return entries.filter(entry => entry.isFile()).map(entry => join(directory, entry.name));
}
const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex');

/**
 * electron-builder 的输出目录：安装包 + 自动更新产物（zip/exe + blockmap）+ latest*.yml。
 * 自动更新元数据必须保持原文件名（latest-mac.yml / latest.yml），否则 electron-updater 找不到。
 */
export async function stageAssets({ bundle, destination, platform, version, artifactPaths }) {
  const target = targets.find(item => item.platform === platform);
  if (!target) throw new Error(`Unknown platform: ${platform}`);
  const files = artifactPaths ?? await bundleFiles(bundle);
  const metadata = target.metadataFiles.map(name => files.find(file => basename(file) === name)).filter(Boolean);
  if (metadata.length !== target.metadataFiles.length) {
    throw new Error(`Missing update metadata for ${platform}: ${target.metadataFiles.join(', ')}`);
  }
  const updaters = files.filter(file => target.updaterExtensions.some(ext => file.endsWith(ext))
    && !file.endsWith('.yml') && !file.endsWith('.blockmap'));
  const installers = files.filter(file => file.endsWith(target.installerExtension));
  if (updaters.length !== 1 || installers.length !== 1) {
    throw new Error(`Expected one installer and one updater for ${platform}; found installers: ${JSON.stringify(installers)}, updaters: ${JSON.stringify(updaters)}`);
  }
  for (const file of metadata) {
    const text = await readFile(file, 'utf8');
    if (!new RegExp(`^version:\\s*${version.replace(/\./g, '\\.')}\\s*$`, 'm').test(text)) {
      throw new Error(`Update metadata ${basename(file)} does not describe ${version}`);
    }
  }
  await mkdir(destination, { recursive: true });
  const assets = [];
  const blockmaps = files.filter(file => file.endsWith('.blockmap'));
  for (const file of new Set([installers[0], updaters[0], ...metadata, ...blockmaps])) {
    if (!(await stat(file)).size) throw new Error(`Empty release asset: ${file}`);
    const name = basename(file);
    await copyFile(file, join(destination, name));
    assets.push({ name, sha256: await digest(file) });
  }
  const manifest = {
    platform, version,
    installer: basename(installers[0]),
    updater: basename(updaters[0]),
    metadata: metadata.map(file => basename(file)),
    assets,
  };
  await writeJson(join(destination, `${platform}.manifest.json`), manifest);
  return manifest;
}

export async function assembleAssets({ directory, version, tag = `v${version}` }) {
  if (releaseVersion(tag).version !== version) throw new Error('Release tag and artifact version do not match');
  const expected = new Set(targets.map(target => target.platform));
  const manifests = (await readdir(directory)).filter(name => name.endsWith('.manifest.json'));
  const assets = [], names = new Set();
  for (const name of manifests) {
    const manifest = await readJson(join(directory, name));
    if (!expected.delete(manifest.platform) || manifest.version !== version) throw new Error(`Unexpected, duplicate or stale manifest: ${name}`);
    for (const platform of targets) {
      if (platform.platform !== manifest.platform) continue;
      const missing = [...platform.metadataFiles, manifest.installer, manifest.updater, ...manifest.assets.map(asset => asset.name)]
        .filter((value, index, list) => list.indexOf(value) === index)
        .filter(value => !manifest.assets.some(asset => asset.name === value));
      if (missing.length) throw new Error(`Missing updater metadata in ${name}: ${missing.join(', ')}`);
    }
    for (const asset of manifest.assets) {
      if (basename(asset.name) !== asset.name || names.has(asset.name)) throw new Error(`Unsafe or duplicate asset: ${asset.name}`);
      names.add(asset.name);
      const path = join(directory, asset.name);
      if (!(await stat(path)).size || await digest(path) !== asset.sha256) throw new Error(`Corrupt asset: ${asset.name}`);
      assets.push(asset);
    }
  }
  if (expected.size) throw new Error(`Missing platforms: ${[...expected].join(', ')}`);
  await writeFile(join(directory, 'SHA256SUMS'), assets.map(asset => `${asset.sha256}  ${asset.name}`).sort().join('\n') + '\n');
  return [...assets.map(asset => join(directory, asset.name)), join(directory, 'SHA256SUMS')];
}

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
async function main() {
  const command = process.argv[2];
  const requested = process.argv[3] || process.env.RELEASE_TAG || `v${(await readJson(join(root, 'package.json'))).version}`;
  const release = releaseVersion(requested);
  if (command === 'version') return syncVersion(release.version);
  if (command === 'metadata') {
    const sha = process.env.GITHUB_SHA;
    // Listing refs distinguishes an absent tag from a failed API request.
    const refs = JSON.parse(gh('api', `repos/${process.env.GITHUB_REPOSITORY}/git/matching-refs/tags/${release.tag}`));
    if (refs.some(ref => ref.ref === `refs/tags/${release.tag}`)) {
      const commit = gh('api', `repos/${process.env.GITHUB_REPOSITORY}/commits/${release.tag}`, '--jq', '.sha');
      if (commit !== sha) throw new Error(`${release.tag} points at another commit; tags will never be moved`);
    }
    await appendFile(process.env.GITHUB_OUTPUT, `tag=${release.tag}\nversion=${release.version}\nprerelease=${release.prerelease}\nmatrix=${JSON.stringify({ include: targets })}\n`);
    return;
  }
  if (command === 'stage') return stageAssets({ bundle: process.env.BUNDLE_DIR, destination: process.env.ASSET_DIR, platform: process.env.RELEASE_PLATFORM, version: release.version, artifactPaths: process.env.BUNDLE_ARTIFACTS ? JSON.parse(process.env.BUNDLE_ARTIFACTS) : undefined });
  if (command === 'publish') {
    const repository = process.env.GITHUB_REPOSITORY;
    const assets = await assembleAssets({ directory: process.env.ASSET_DIR, version: release.version, tag: release.tag });
    const releases = JSON.parse(gh('api', '--paginate', '--slurp', `repos/${repository}/releases?per_page=100`)).flat();
    const existing = releases.find(item => item.tag_name === release.tag);
    if (existing && !existing.draft) throw new Error(`${release.tag} is already public; use a new version instead of replacing released files`);
    if (existing && existing.target_commitish !== process.env.GITHUB_SHA) throw new Error('Existing draft belongs to a different commit');
    if (!existing) gh('release', 'create', release.tag, '--draft', '--target', process.env.GITHUB_SHA, '--title', `Shotloom ${release.tag}`, '--generate-notes', ...(release.prerelease ? ['--prerelease'] : []));
    // A failed upload leaves a draft which the same commit can safely retry.
    gh('release', 'upload', release.tag, ...assets, '--clobber');
    gh('release', 'edit', release.tag, '--draft=false', `--prerelease=${release.prerelease}`, ...(release.prerelease ? ['--latest=false'] : []));
    return;
  }
  throw new Error('Usage: desktop-release.mjs <version|metadata|stage|publish> [vX.Y.Z]');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
