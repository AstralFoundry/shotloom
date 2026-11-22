import videoTools from '../../assets/open-ai-canvas/video-tools.json' with { type: 'json' };

export const { categories: VIDEO_MOTION_CATEGORIES, motions: VIDEO_MOTIONS, templates: VIDEO_PROMPT_TEMPLATES } = videoTools;

const motionById = new Map(VIDEO_MOTIONS.map(motion => [motion.id, motion]));

export function selectedVideoMotions(ids: unknown) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids)].flatMap(id => {
    const motion = typeof id === 'string' ? motionById.get(id) : undefined;
    return motion ? [motion] : [];
  });
}

export function applyVideoMotions(prompt: string, ids: unknown) {
  return [prompt, ...selectedVideoMotions(ids).map(motion => motion.prompt)].filter(Boolean).join('\n\n');
}
