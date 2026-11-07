import {
  CINEMA_CAMERAS,
  CINEMA_LENSES,
  composeCinemaPrompt,
  DEFAULT_CINEMA_CAMERA_ID,
  DEFAULT_CINEMA_LENS_ID,
  findCinemaCamera,
  findCinemaLens,
} from './cinemaCameraLibrary.ts';

type CameraConfigLike = {
  camera?: unknown;
  lens?: unknown;
  focalLength?: unknown;
  aperture?: unknown;
  cameraProfileId?: unknown;
  lensProfileId?: unknown;
};

/** 通用选项保留给旧配置和外部调用；镜头库面板使用带完整色彩/光学描述的 profile。 */
export const CAMERA_OPTIONS = Object.freeze([
  'IMAX Keighley',
  'ARRI Alexa',
  'RED Dragon',
  'Sony Venice',
  'Canon EOS R5',
  'Nikon D850',
  'Panasonic GH5',
  'Blackmagic URSA',
]);

export const LENS_OPTIONS = Object.freeze([
  'Zeiss Ultra Prime',
  'Canon EF',
  'Nikon Nikkor',
  'Sony G Master',
  'Leica Summilux',
  'Sigma Art',
  'Tamron SP',
  'Fujifilm XF',
]);

export const FOCAL_LENGTH_OPTIONS = Object.freeze([
  '14mm', '24mm', '35mm', '50mm', '75mm', '85mm', '105mm', '135mm', '200mm',
]);

export const APERTURE_OPTIONS = Object.freeze([
  'f/1.2', 'f/1.4', 'f/2.0', 'f/2.8', 'f/4.0', 'f/5.6', 'f/8.0', 'f/11', 'f/16',
]);

export const DEFAULT_CAMERA_CONFIG = Object.freeze({
  camera: CINEMA_CAMERAS[0]!.name,
  lens: CINEMA_LENSES[0]!.name,
  focalLength: '50mm',
  aperture: 'f/2.8',
  cameraProfileId: DEFAULT_CINEMA_CAMERA_ID,
  lensProfileId: DEFAULT_CINEMA_LENS_ID,
});

function optionOrDefault(value: unknown, options: readonly string[], fallback: string) {
  return typeof value === 'string' && options.includes(value) ? value : fallback;
}

function profileIdOrDefault(value: unknown, ids: Set<string>, fallback: string) {
  return typeof value === 'string' && ids.has(value) ? value : fallback;
}

export function normalizeCameraConfig(config: CameraConfigLike | null = {}) {
  const cameraProfileId = typeof config?.cameraProfileId === 'string'
    ? profileIdOrDefault(config.cameraProfileId, new Set(CINEMA_CAMERAS.map((item) => item.id)), '')
    : '';
  const lensProfileId = typeof config?.lensProfileId === 'string'
    ? profileIdOrDefault(config.lensProfileId, new Set(CINEMA_LENSES.map((item) => item.id)), '')
    : '';
  const cameraProfile = findCinemaCamera(cameraProfileId);
  const lensProfile = findCinemaLens(lensProfileId);
  return {
    camera: cameraProfile?.name ?? optionOrDefault(config?.camera, CAMERA_OPTIONS, DEFAULT_CAMERA_CONFIG.camera),
    lens: lensProfile?.name ?? optionOrDefault(config?.lens, LENS_OPTIONS, DEFAULT_CAMERA_CONFIG.lens),
    focalLength: optionOrDefault(config?.focalLength, FOCAL_LENGTH_OPTIONS, DEFAULT_CAMERA_CONFIG.focalLength),
    aperture: optionOrDefault(config?.aperture, APERTURE_OPTIONS, DEFAULT_CAMERA_CONFIG.aperture),
    cameraProfileId,
    lensProfileId,
  };
}

export function cameraPromptParts(config: CameraConfigLike | null = {}) {
  const normalized = normalizeCameraConfig(config);
  const camera = findCinemaCamera(normalized.cameraProfileId);
  const lens = findCinemaLens(normalized.lensProfileId);
  if (camera && lens) {
    return [composeCinemaPrompt({
      cameraId: camera.id,
      lensId: lens.id,
      focalLength: normalized.focalLength,
      aperture: normalized.aperture,
    })];
  }
  return [
    `Camera: ${normalized.camera}`,
    `Lens: ${normalized.lens}`,
    `Focal Length: ${normalized.focalLength}`,
    `Aperture: ${normalized.aperture}`,
  ];
}

export function applyCameraConfigToPrompt(prompt = '', config: CameraConfigLike | null = {}) {
  return [String(prompt || '').trim(), cameraPromptParts(config).join(', ')]
    .filter(Boolean)
    .join(', ');
}
