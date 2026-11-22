import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { AGENT_PET_STATES, readAgentPetArchive } from '../renderer/src/services/agentPetArchive.ts';

function characterFiles(folder = '', id = 'sample') {
  const clips = Object.fromEntries(AGENT_PET_STATES.map(state => [state, `${state}.webm`]));
  return {
    [folder + 'avatar.json']: strToU8(JSON.stringify({
      version: 1, character: { id, name: 'Sample' }, poster: 'poster.png', clips,
    })),
    [folder + 'poster.png']: Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    ...Object.fromEntries(Object.values(clips).map(name => [folder + name, Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3)])),
  };
}

test('reads a single pet and multi-character ZIPs with nested manifests', () => {
  const [single] = readAgentPetArchive(zipSync(characterFiles()));
  assert.equal(single.id, 'sample');
  assert.equal(single.poster.type, 'image/png');
  assert.deepEqual(Object.keys(single.clips), AGENT_PET_STATES);
  assert.equal(single.clips.completed.type, 'video/webm');
  const pack = zipSync({ ...characterFiles('pets/first/', 'first'), ...characterFiles('pets/second/', 'second') });
  assert.deepEqual(readAgentPetArchive(pack).map(pet => pet.id), ['first', 'second']);
});

test('rejects path traversal, duplicate IDs, and missing or mislabeled media', () => {
  assert.throws(() => readAgentPetArchive(zipSync({ ...characterFiles(), '../outside.png': Uint8Array.of(1) })), { reason: 'invalid' });
  assert.throws(() => readAgentPetArchive(zipSync({ ...characterFiles('a/'), ...characterFiles('b/') })), { reason: 'duplicate' });
  assert.throws(() => readAgentPetArchive(zipSync({ ...characterFiles(), 'idle.webm': strToU8('<html>') })), { reason: 'invalid' });
  const missingClip = characterFiles();
  delete missingClip['idle.webm'];
  assert.throws(() => readAgentPetArchive(zipSync(missingClip)), { reason: 'invalid' });
});

test('stops reading ZIPs that exceed the file count limit', () => {
  const entries = Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`extra-${i}.txt`, Uint8Array.of(1)]));
  assert.throws(() => readAgentPetArchive(zipSync({ ...characterFiles(), ...entries })), { reason: 'tooLarge' });
});
