import imageTools from '../../assets/open-ai-canvas/image-tools.json' with { type: 'json' };

export const IMAGE_COMPOSITION_GROUPS = {
  storyboard: {
    shortStoryboard: 'short_storyboard',
    blockingStoryboard: 'blocking_storyboard',
    pitchGrid: 'story_pitch_four_grid',
    storyboard25: 'storyboard_25_grid',
  },
  coverage: { cameraGrid: 'multi_camera_nine_grid', lightCorrection: 'cinematic_light_correction' },
  continuity: { before5Seconds: 'image_projection_before_5s', after3Seconds: 'image_projection_after_3s' },
  sheets: {
    characterFourView: 'character_four_view',
    characterThreeView: 'character_three_view_generation',
    faceThreeView: 'character_face_three_view',
    productThreeView: 'product_three_view',
  },
} as const;

export const IMAGE_COMPOSITION_PRESETS = {
  ...IMAGE_COMPOSITION_GROUPS.storyboard,
  ...IMAGE_COMPOSITION_GROUPS.coverage,
  ...IMAGE_COMPOSITION_GROUPS.continuity,
  ...IMAGE_COMPOSITION_GROUPS.sheets,
};
export type ImageCompositionPreset = keyof typeof IMAGE_COMPOSITION_PRESETS;

export function getImageCompositionPreset(id: unknown) {
  if (typeof id !== 'string' || !Object.hasOwn(IMAGE_COMPOSITION_PRESETS, id)) return undefined;
  const key = id as ImageCompositionPreset;
  return { id: key, ...imageTools.compositions[IMAGE_COMPOSITION_PRESETS[key]] };
}

export function applyImageCompositionPreset(prompt: string, presetId: unknown): string {
  const preset = getImageCompositionPreset(presetId);
  if (!preset) return prompt;
  return prompt ? `${prompt}\n\n${preset.prompt}` : preset.prompt;
}
