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

export interface GenerationInputEdge {
  id: string;
  data?: Record<string, unknown>;
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

/**
 * Reassign media edges when the user changes business input mode. Existing
 * explicit first/last-frame identities win; remaining references only fill
 * vacant slots. Inputs beyond the active mode's capacity stay connected but do
 * not enter task compilation, so expanding the mode restores them instead of
 * silently losing an upstream node.
 */
export function reconcileGenerationInputEdges<T extends GenerationInputEdge>(
  edges: T[],
  mode: GenerationInputModeDescriptor,
): T[] {
  const textEdges = edges.filter((edge) => edge.data?.inputRole === 'textContext').map((edge) => {
    const { skipTaskInput: _skipTaskInput, ...data } = edge.data || {};
    edge.data = data;
    return edge;
  });
  const imageEdges = edges.filter((edge) => edge.data?.inputRole === 'referenceImage');
  const videoEdges = edges.filter((edge) => edge.data?.inputRole === 'inputVideo');
  const audioEdges = edges.filter((edge) => edge.data?.inputRole === 'referenceAudio');

  const rankedImages = imageEdges
    .map((edge, index) => ({ edge, index }))
    .sort((left, right) => {
      const slotDifference = inputSlotOrder(String(left.edge.data?.inputSlot || ''))
        - inputSlotOrder(String(right.edge.data?.inputSlot || ''));
      return slotDifference || left.index - right.index;
    })
    .map(({ edge }) => edge);
  const remaining = new Set(rankedImages);
  const selectedImages: T[] = [];
  const imageSlots = mode.slots.filter((slot) => ['reference', 'firstFrame', 'lastFrame'].includes(slot));
  const desiredSlots = imageSlots.includes('reference')
    ? Array.from({ length: mode.maxImages }, () => 'reference' as GenerationInputSlot)
    : imageSlots.slice(0, mode.maxImages);

  for (const slot of desiredSlots) {
    let selected = rankedImages.find((edge) => (
      remaining.has(edge) && edge.data?.inputSlot === slot
    ));
    if (!selected) selected = rankedImages.find((edge) => remaining.has(edge));
    if (!selected) break;
    remaining.delete(selected);
    const { skipTaskInput: _skipTaskInput, ...data } = selected.data || {};
    selected.data = { ...data, inputRole: 'referenceImage', inputSlot: slot };
    selectedImages.push(selected);
  }

  const inactiveImages = rankedImages.filter((edge) => remaining.has(edge)).map((edge) => {
    edge.data = { ...(edge.data || {}), inputRole: 'referenceImage', skipTaskInput: true };
    return edge;
  });

  const selectedVideos = videoEdges.slice(0, mode.maxVideos).map((edge) => {
    const { skipTaskInput: _skipTaskInput, ...data } = edge.data || {};
    edge.data = { ...data, inputRole: 'inputVideo', inputSlot: 'inputVideo' };
    return edge;
  });
  const inactiveVideos = videoEdges.slice(mode.maxVideos).map((edge) => {
    edge.data = { ...(edge.data || {}), inputRole: 'inputVideo', skipTaskInput: true };
    return edge;
  });
  const selectedAudios = audioEdges.slice(0, mode.maxAudios).map((edge) => {
    const { skipTaskInput: _skipTaskInput, ...data } = edge.data || {};
    edge.data = { ...data, inputRole: 'referenceAudio', inputSlot: 'referenceAudio' };
    return edge;
  });
  const inactiveAudios = audioEdges.slice(mode.maxAudios).map((edge) => {
    edge.data = { ...(edge.data || {}), inputRole: 'referenceAudio', skipTaskInput: true };
    return edge;
  });
  return [
    ...textEdges,
    ...selectedImages,
    ...inactiveImages,
    ...selectedVideos,
    ...inactiveVideos,
    ...selectedAudios,
    ...inactiveAudios,
  ];
}
