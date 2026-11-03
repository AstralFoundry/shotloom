export type GenerationInputRole = 'auto' | 'textContext' | 'referenceImage' | 'inputVideo' | 'referenceAudio';

const CANONICAL_INPUT_ROLES: string[] = [
  'auto',
  'textContext',
  'referenceImage',
  'inputVideo',
  'referenceAudio',
];

export function normalizeInputRole(value: unknown = 'auto'): GenerationInputRole {
  const role = String(value || 'auto');
  return (CANONICAL_INPUT_ROLES.includes(role) ? role : 'auto') as GenerationInputRole;
}
