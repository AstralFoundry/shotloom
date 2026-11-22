import { AGENT_PET_STATES, AgentPetArchiveError, type AgentPetState, type ImportedAgentPet } from './agentPetArchive';

export interface AgentPet {
  id: string;
  name: string;
  poster: string | Blob;
  clips: Record<AgentPetState, string | Blob>;
  imported?: boolean;
}

const builtinPets: AgentPet[] = Object.entries({
  deepseek: 'DeepSeek', gpt: 'GPT', claude: 'Claude', gemini: 'Gemini',
  glm: 'GLM', kimi: 'Kimi', qwen: 'Qwen',
}).map(([id, name]) => {
  const base = `./agent-pets/${id}/${id}-`;
  return {
    id, name, poster: `${base}poster.png`,
    clips: Object.fromEntries(AGENT_PET_STATES.map(state => [state, `${base}${state}.webm`])) as AgentPet['clips'],
  };
});

interface Preferences {
  selected: string;
  visible: boolean;
  custom: ImportedAgentPet[];
}

const initial: Preferences = { selected: 'deepseek', visible: true, custom: [] };
let snapshot = { pets: builtinPets, selected: initial.selected, visible: initial.visible };
const listeners = new Set<() => void>();
let database: Promise<IDBDatabase> | undefined;
let loading: Promise<void> | undefined;

export function getAgentPetLibrary() {
  return snapshot;
}

export function subscribeAgentPetLibrary(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function publish({ selected, visible, custom }: Preferences) {
  const pets = [...builtinPets, ...custom.map(pet => ({ ...pet, id: `custom:${pet.id}`, imported: true }))];
  snapshot = { pets, visible, selected: pets.some(pet => pet.id === selected) ? selected : initial.selected };
  for (const listener of listeners) listener();
}

function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('shotloom-agent-pets', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('library');
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = undefined; };
      resolve(request.result);
    };
  });
  return database;
}

async function accessLibrary(update?: (current: Preferences) => Preferences) {
  const db = await openDatabase();
  return new Promise<Preferences>((resolve, reject) => {
    const transaction = db.transaction('library', update ? 'readwrite' : 'readonly');
    const store = transaction.objectStore('library');
    let next = initial;
    let cause: unknown;
    const request = store.get('preferences');
    request.onsuccess = () => {
      try {
        next = request.result ?? initial;
        if (update) {
          next = update(next);
          store.put(next, 'preferences');
        }
      } catch (error) {
        cause = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(next);
    transaction.onabort = () => reject(cause ?? transaction.error);
  });
}

export function loadAgentPetLibrary() {
  loading ??= accessLibrary().then(publish).catch(error => { loading = undefined; throw error; });
  return loading;
}

async function updateLibrary(update: (current: Preferences) => Preferences) {
  await loadAgentPetLibrary();
  publish(await accessLibrary(update));
}

export function selectAgentPet(id: string) {
  return updateLibrary(current => {
    if (!builtinPets.some(pet => pet.id === id) && !current.custom.some(pet => `custom:${pet.id}` === id)) return current;
    return { ...current, selected: id, visible: true };
  });
}

export function setAgentPetVisible(visible: boolean) {
  return updateLibrary(current => ({ ...current, visible }));
}

export function addAgentPets(pets: ImportedAgentPet[]) {
  const first = pets[0];
  if (!first) throw new AgentPetArchiveError('invalid');
  return updateLibrary(current => {
    if (pets.some(pet => current.custom.some(existing => existing.id === pet.id))) throw new AgentPetArchiveError('duplicate');
    return { ...current, custom: [...current.custom, ...pets], selected: `custom:${first.id}`, visible: true };
  });
}

export function removeAgentPet(id: string) {
  return updateLibrary(current => ({
    ...current,
    custom: current.custom.filter(pet => `custom:${pet.id}` !== id),
    selected: current.selected === id ? initial.selected : current.selected,
  }));
}
