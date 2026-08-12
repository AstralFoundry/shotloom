const CANONICAL_INPUT_ROLES = new Set([
  'auto',
  'textContext',
  'referenceImage',
  'inputVideo',
  'referenceAudio',
]);

export function normalizeInputRole(value = 'auto') {
  const role = String(value || 'auto');
  return CANONICAL_INPUT_ROLES.has(role) ? role : 'auto';
}
