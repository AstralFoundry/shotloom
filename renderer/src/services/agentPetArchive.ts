import { strFromU8, unzipSync } from 'fflate';

export const AGENT_PET_STATES = ['idle', 'thinking', 'working', 'completed'] as const;
export type AgentPetState = typeof AGENT_PET_STATES[number];

export interface ImportedAgentPet {
  id: string;
  name: string;
  poster: Blob;
  clips: Record<AgentPetState, Blob>;
}

const MIB = 1024 * 1024;
export const AGENT_PET_ZIP_LIMIT = 40 * MIB;
const MAX_EXPANDED = 80 * MIB;
const mediaTypes: Record<string, string> = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', webm: 'video/webm' };

export class AgentPetArchiveError extends Error {
  readonly reason: 'invalid' | 'tooLarge' | 'duplicate';

  constructor(reason: AgentPetArchiveError['reason']) {
    super(reason);
    this.reason = reason;
  }
}

function invalid(): never {
  throw new AgentPetArchiveError('invalid');
}

function safePath(name: string) {
  return name.length <= 240 && !/[\\:\x00-\x1f\x7f]/.test(name)
    && name.split('/').every(part => part && part !== '.' && part !== '..');
}

function mediaBlob(files: Record<string, Uint8Array>, folder: string, name: unknown, video: boolean) {
  if (typeof name !== 'string' || !safePath(name)) return invalid();
  const path = folder + name;
  const bytes = Object.hasOwn(files, path) ? files[path] : undefined;
  const extension = name.split('.').at(-1)?.toLowerCase() ?? '';
  const mime = Object.hasOwn(mediaTypes, extension) ? mediaTypes[extension] : undefined;
  if (!bytes?.length || !mime || video !== (extension === 'webm')) return invalid();

  const begins = (...header: number[]) => header.every((byte, index) => bytes[index] === byte);
  const valid = extension === 'webm' ? begins(0x1a, 0x45, 0xdf, 0xa3)
    : extension === 'png' ? begins(137, 80, 78, 71, 13, 10, 26, 10)
    : extension === 'webp' ? begins(82, 73, 70, 70) && strFromU8(bytes.subarray(8, 12)) === 'WEBP'
    : begins(0xff, 0xd8, 0xff);
  if (!valid) return invalid();
  return new Blob([new Uint8Array(bytes)], { type: mime });
}

export function readAgentPetArchive(bytes: Uint8Array): ImportedAgentPet[] {
  if (bytes.length > AGENT_PET_ZIP_LIMIT) throw new AgentPetArchiveError('tooLarge');
  if (bytes.length < 22) return invalid();

  try {
    const seen = new Set<string>();
    let expanded = 0;
    const files = unzipSync(bytes, { filter({ name, size, originalSize, compression }) {
      if (!safePath(name.endsWith('/') ? name.slice(0, -1) : name)
          || seen.has(name) || name === '__proto__') return invalid();
      seen.add(name);
      expanded += Math.max(originalSize, size);
      if (seen.size > 256 || expanded > MAX_EXPANDED) throw new AgentPetArchiveError('tooLarge');
      if (compression === 0 && size !== originalSize) return invalid();
      if (name.split('/').some(part => part.startsWith('.') || part === '__MACOSX')) return false;
      if (/(^|\/)avatar\.json$/.test(name)) {
        if (originalSize > 64 * 1024) return invalid();
        return true;
      }
      return /\.(webm|png|webp|jpe?g)$/i.test(name);
    } });

    const ids = new Set<string>();
    const pets = Object.keys(files).filter(path => /(^|\/)avatar\.json$/.test(path)).map(path => {
      const manifestBytes = files[path];
      if (!manifestBytes) return invalid();
      const manifest = JSON.parse(strFromU8(manifestBytes));
      const id = manifest?.character?.id;
      const name = manifest?.character?.name;
      if (manifest?.version !== 1 || typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id)
          || typeof name !== 'string' || !name.trim() || name.length > 80) return invalid();
      if (ids.has(id)) throw new AgentPetArchiveError('duplicate');
      ids.add(id);
      const folder = path.slice(0, -'avatar.json'.length);
      const poster = mediaBlob(files, folder, manifest.poster, false);
      const clips = Object.fromEntries(AGENT_PET_STATES.map(state =>
        [state, mediaBlob(files, folder, manifest.clips?.[state], true)])) as ImportedAgentPet['clips'];
      return { id, name: name.trim(), poster, clips };
    });
    if (!pets.length) return invalid();
    return pets;
  } catch (error) {
    if (error instanceof AgentPetArchiveError) throw error;
    return invalid();
  }
}
