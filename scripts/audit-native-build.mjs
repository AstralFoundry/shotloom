import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const advisory = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
// shortcut: upstream has no patched release; remove this build-only exception by December 2, 2026.
export function knownBuildAdvisory(report, now = Date.now()) {
  const findings = Object.values(report.vulnerabilities || {});
  return now < Date.parse('2026-12-02T00:00:00Z') && findings.length > 0
    && findings.some(item => item.name === 'picomatch' && item.via.some(cause => cause.url === advisory))
    && findings.every(item => Array.isArray(item.via) && item.via.length > 0 && item.via.every(cause =>
      typeof cause === 'string' ? Object.hasOwn(report.vulnerabilities, cause) : cause.url === advisory));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const native = fileURLToPath(new URL('../mobile/native/', import.meta.url));
  const audit = spawnSync(process.execPath, [process.env.npm_execpath, 'audit', '--json'], { cwd: native, encoding: 'utf8' });
  assert.ifError(audit.error);
  const report = JSON.parse(audit.stdout);
  if (audit.status !== 0) {
    console.log(audit.stdout);
    assert(knownBuildAdvisory(report), 'Unreviewed vulnerability or expired exception: build blocked');
    execFileSync(process.execPath, [join(native, 'node_modules/expo/bin/cli'), 'export', '--platform', 'android', '--source-maps', '--output-dir', 'dist-audit'], { cwd: native, stdio: 'inherit' });
    const files = readdirSync(join(native, 'dist-audit'), { recursive: true }).filter(path => path.endsWith('.map'));
    assert(files.length > 0, 'Runtime dependency inventory is required');
    for (const path of files) {
      const map = JSON.parse(readFileSync(join(native, 'dist-audit', path), 'utf8'));
      assert(map.sources?.length > 0, 'Runtime dependency inventory is empty');
      assert(map.sources.every(source => !['picomatch', 'micromatch', 'tinyglobby', 'fdir'].some(name => source.replaceAll('\\', '/').includes(`/${name}/`))), 'Affected glob dependency entered the Android runtime');
    }
    console.log('Temporary build-only advisory exception: runtime inventory verified; expires 2026-12-02.');
  } else console.log('Native dependency audit passed.');
}
