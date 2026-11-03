type CameraConfigLike = {
  camera?: unknown;
  lens?: unknown;
  focalLength?: unknown;
  aperture?: unknown;
};

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
  '14mm',
  '24mm',
  '35mm',
  '50mm',
  '75mm',
  '85mm',
  '105mm',
  '135mm',
  '200mm',
]);

export const APERTURE_OPTIONS = Object.freeze([
  'f/1.2',
  'f/1.4',
  'f/2.0',
  'f/2.8',
  'f/4.0',
  'f/5.6',
  'f/8.0',
  'f/11',
  'f/16',
]);

export const DEFAULT_CAMERA_CONFIG = Object.freeze({
  camera: CAMERA_OPTIONS[0] as string,
  lens: LENS_OPTIONS[0] as string,
  focalLength: FOCAL_LENGTH_OPTIONS[3] as string,
  aperture: APERTURE_OPTIONS[1] as string,
});

function optionOrDefault(value: unknown, options: readonly string[], fallback: string) {
  return typeof value === 'string' && options.includes(value) ? value : fallback;
}

export function normalizeCameraConfig(config: CameraConfigLike | null = {}) {
  return {
    camera: optionOrDefault(config?.camera, CAMERA_OPTIONS, DEFAULT_CAMERA_CONFIG.camera),
    lens: optionOrDefault(config?.lens, LENS_OPTIONS, DEFAULT_CAMERA_CONFIG.lens),
    focalLength: optionOrDefault(config?.focalLength, FOCAL_LENGTH_OPTIONS, DEFAULT_CAMERA_CONFIG.focalLength),
    aperture: optionOrDefault(config?.aperture, APERTURE_OPTIONS, DEFAULT_CAMERA_CONFIG.aperture),
  };
}

export function cameraPromptParts(config: CameraConfigLike | null = {}) {
  const normalized = normalizeCameraConfig(config);
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
