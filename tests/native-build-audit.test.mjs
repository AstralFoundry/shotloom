import assert from 'node:assert/strict';
import test from 'node:test';
import { knownBuildAdvisory } from '../scripts/audit-native-build.mjs';

test('native build exception accepts only the reviewed advisory and expires', () => {
  const report = { vulnerabilities: {
    picomatch: { name: 'picomatch', via: [{ url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf' }] },
    expo: { name: 'expo', via: ['picomatch'] },
  } };
  const now = Date.parse('2026-11-18T00:00:00Z');
  assert.equal(knownBuildAdvisory(report, now), true);
  assert.equal(knownBuildAdvisory(report, Date.parse('2026-12-02T00:00:00Z')), false);
  assert.equal(knownBuildAdvisory({}, now), false);
  assert.equal(knownBuildAdvisory({ vulnerabilities: { ...report.vulnerabilities, other: { name: 'other', via: [{ url: 'https://github.com/advisories/new-vulnerability' }] } } }, now), false);
  assert.equal(knownBuildAdvisory({ vulnerabilities: { expo: { name: 'expo', via: ['unknown'] } } }, now), false);
});
