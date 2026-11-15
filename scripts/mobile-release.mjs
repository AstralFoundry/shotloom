import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { releaseVersion } from './desktop-release.mjs';

export async function prepareMobileRelease({ tag, origin = 'https://shotloom.0xfiang.com', directory = resolve('mobile/src-tauri') }) {
  const { version } = releaseVersion(tag);
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('SHOTLOOM_CLOUD_URL must be an HTTPS origin');
  }
  const configPath = join(directory, 'tauri.conf.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.version = version;
  config.build.frontendDist = url.origin;
  config.app.windows[0].url = url.origin;
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  for (const [file, pattern] of [
    ['Cargo.toml', /(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+(")/],
    ['Cargo.lock', /(\[\[package\]\]\r?\nname = "shotloom-mobile"\r?\nversion = ")[^"]+(")/],
  ]) {
    const path = join(directory, file);
    const source = await readFile(path, 'utf8');
    if (!pattern.test(source)) throw new Error(`Cannot find mobile version in ${file}`);
    await writeFile(path, source.replace(pattern, (_, before, after) => `${before}${version}${after}`));
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await prepareMobileRelease({ tag: process.env.RELEASE_TAG, origin: process.env.SHOTLOOM_CLOUD_URL || undefined });
}
