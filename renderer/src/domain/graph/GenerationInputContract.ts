export type GenerationInputMode =
  | 'reference'
  | 'firstFrame'
  | 'firstLastFrame'
  | 'videoExtension';

export type GenerationInputSlot =
  | 'reference'
  | 'firstFrame'
  | 'lastFrame'
  | 'inputVideo'
  | 'referenceAudio';

export interface GenerationInputModeDescriptor {
  value: GenerationInputMode;
  label: string;
  modeId: string;
  slots: GenerationInputSlot[];
  maxImages: number;
  maxVideos: number;
  maxAudios: number;
}

export const GENERATION_INPUT_MODE_LABELS: Record<GenerationInputMode, string> = {
  reference: '参考素材',
  firstFrame: '首帧',
  firstLastFrame: '首尾帧',
  videoExtension: '视频续写',
};

export function slotsForInputMode(mode: GenerationInputMode): GenerationInputSlot[] {
  if (mode === 'firstFrame') return ['firstFrame'];
  if (mode === 'firstLastFrame') return ['firstFrame', 'lastFrame'];
  if (mode === 'videoExtension') return ['inputVideo'];
  return ['reference'];
}

export function defaultInputSlot(
  mode: GenerationInputMode,
  inputRole: string,
  occupied: GenerationInputSlot[] = [],
): GenerationInputSlot {
  if (inputRole === 'inputVideo') return 'inputVideo';
  if (inputRole === 'referenceAudio') return 'referenceAudio';
  if (mode === 'firstFrame') return 'firstFrame';
  if (mode === 'firstLastFrame') {
    return occupied.includes('firstFrame') ? 'lastFrame' : 'firstFrame';
  }
  return 'reference';
}

export function isSlotValidForMode(
  mode: GenerationInputMode,
  slot: GenerationInputSlot,
  inputRole: string,
): boolean {
  if (inputRole === 'inputVideo') return slot === 'inputVideo';
  if (inputRole === 'referenceAudio') return slot === 'referenceAudio';
  return slotsForInputMode(mode).includes(slot);
}

export function inputSlotOrder(slot: string): number {
  return ({ firstFrame: 0, lastFrame: 1, reference: 2, inputVideo: 3, referenceAudio: 4 } as Record<string, number>)[slot] ?? 9;
}
