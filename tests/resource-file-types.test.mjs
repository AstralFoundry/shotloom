import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RESOURCE_FILE_EXTENSIONS,
  resourceFileDialogFilters,
} from '../renderer/src/utils/resourceFileTypes.mjs';

test('resource picker exposes a dedicated native dialog filter for every generation type', () => {
  for (const resourceType of ['image', 'video', 'audio', 'text']) {
    const filters = resourceFileDialogFilters(resourceType);
    assert.equal(filters.length, 1);
    assert.deepEqual(filters[0].extensions, [...RESOURCE_FILE_EXTENSIONS[resourceType]]);
  }
});

test('generic resource picking remains unrestricted', () => {
  assert.equal(resourceFileDialogFilters(), undefined);
  assert.equal(resourceFileDialogFilters('file'), undefined);
});
