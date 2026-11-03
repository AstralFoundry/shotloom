import { t } from '../../i18n/index.ts';
import type { OpenReelNativeState } from '../../../../vendor/openreel/apps/web/src/embedded/runtime-types';
import { isRecord } from '../../utils/typeGuards.ts';

/** Minimum durable OpenReel snapshot contract; vendor owns the remaining fields. */
export function assertNativeSnapshot(value: unknown): asserts value is OpenReelNativeState {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id ||
      !isRecord(value.settings) || !(Number(value.settings.width) > 0) || !(Number(value.settings.height) > 0) ||
      !isRecord(value.timeline) || !Array.isArray(value.timeline.tracks) ||
      !isRecord(value.mediaLibrary) || !Array.isArray(value.mediaLibrary.items) ||
      value.timeline.tracks.some(track => !isRecord(track) || typeof track.id !== 'string' || !Array.isArray(track.clips))) {
    throw new Error(t('editor.snapshot.invalid'));
  }
}
