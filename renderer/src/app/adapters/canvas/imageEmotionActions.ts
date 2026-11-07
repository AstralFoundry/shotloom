import { t } from '@/i18n';
import { composeEmotionPrompt, findEmotionPreset, normalizeFaceRect, type FaceRect } from '@/domain/graph/imageEmotion';
import { showToast } from '@/store/notificationStore';
import { createMaskedEditNode } from './imageMaskActions';

export interface EmotionEditInput {
  maskFilePath: string;
  presetId: string;
  extraPrompt?: string;
  faceRect: FaceRect;
}

/** 表情调节本质是一次只改脸的蒙版编辑，落节点逻辑与局部重绘共用。 */
export function applyEmotionEdit(nodeId: string, input: EmotionEditInput): boolean {
  const preset = findEmotionPreset(input.presetId);
  if (!preset) {
    showToast(t('imageEmotion.error.preset'));
    return false;
  }
  const prompt = composeEmotionPrompt(preset, input.extraPrompt || '');
  return createMaskedEditNode(nodeId, {
    prompt,
    maskFilePath: input.maskFilePath,
    mode: 'emotion',
    title: (name) => t('imageEmotion.derivedTitle', { name }),
    historyLabel: t('imageEmotion.history'),
    creationSource: 'image-emotion-edit',
    fields: {
      emotionEdit: {
        presetId: preset.id,
        label: preset.label,
        faceRect: normalizeFaceRect(input.faceRect),
      },
    },
  });
}
