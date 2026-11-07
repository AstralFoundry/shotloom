/**
 * 电影机 / 镜头提示词库。
 *
 * 这些是摄影机与镜头的客观特性（传感器、色彩科学、光学风格）对应的生图描述，
 * 不是固定模板；相机控制开启时，把所选组合作为镜头语言追加到节点提示词。
 */

export interface CinemaCameraProfile {
  id: string;
  name: string;
  zhName: string;
  sensor: string;
  prompt: string;
  description: string;
  useCase: string;
}

export interface CinemaLensProfile {
  id: string;
  name: string;
  zhName: string;
  mount: string;
  prompt: string;
  description: string;
  useCase: string;
}

export const CINEMA_CAMERAS: readonly CinemaCameraProfile[] = Object.freeze([
  {
    id: 'arri_alexa_35',
    name: 'ARRI Alexa 35',
    zhName: '阿莱 Alexa 35',
    sensor: 'Super 35 · ALEV 4',
    prompt: 'shot on ARRI Alexa 35 with ALEV 4 Super 35 sensor, 17 stops of dynamic range, ARRI color science, natural skin tones, soft highlight rolloff, refined feature-film texture',
    description: '当前院线主力机型，宽容度和肤色表现都很稳。',
    useCase: '剧情片、人像、品牌广告',
  },
  {
    id: 'arri_alexa_mini_lf',
    name: 'ARRI Alexa Mini LF',
    zhName: '阿莱 Mini LF',
    sensor: 'Large Format · ALEV III',
    prompt: 'shot on ARRI Alexa Mini LF with large-format ALEV III sensor, ARRI Wide Gamut color science, creamy highlight rolloff, rich organic texture, premium cinema look',
    description: '大画幅阿莱，轻量机身，柔和高光。',
    useCase: '手持剧情、商业片、人物特写',
  },
  {
    id: 'red_v_raptor',
    name: 'RED V-Raptor 8K VV',
    zhName: 'RED V-Raptor 8K',
    sensor: 'Vista Vision · 8K',
    prompt: 'shot on RED V-Raptor 8K VV with RED IPP2 color pipeline, Vista Vision sensor, crisp high-resolution detail, clean shadows, vivid but controlled color',
    description: '8K 大画幅，细节和后期空间充足。',
    useCase: '科幻、VFX、高分辨率广告',
  },
  {
    id: 'sony_venice_2',
    name: 'Sony Venice 2',
    zhName: '索尼 Venice 2',
    sensor: 'Full Frame · 8.6K',
    prompt: 'shot on Sony Venice 2 with full-frame cinema sensor, S-Gamut3.Cine / S-Log3 color science, dual native ISO, clean deep shadows, refined modern color',
    description: '全画幅双原生 ISO，弱光和肤色都强。',
    useCase: '夜景、高端广告、纪录片',
  },
  {
    id: 'sony_fx6',
    name: 'Sony FX6',
    zhName: '索尼 FX6',
    sensor: 'Full Frame · 4K',
    prompt: 'shot on Sony FX6 with full-frame sensor and Venice-derived color science, lightweight documentary character, clean low-light performance, natural contrast',
    description: '轻量全画幅，单兵和纪录片常用。',
    useCase: '纪录片、采访、轻量剧情',
  },
  {
    id: 'panavision_dxl2',
    name: 'Panavision DXL2',
    zhName: '潘那维申 DXL2',
    sensor: 'Large Format · 8K VV',
    prompt: 'shot on Panavision DXL2 with Monstro 8K VV sensor and Panavision color science, large-format depth, rich filmic texture, organic highlight rolloff, premium modern cinema look',
    description: '大画幅电影机，油润的胶片质感。',
    useCase: '顶级商业片、剧情长片',
  },
  {
    id: 'blackmagic_ursa_12k',
    name: 'Blackmagic URSA Cine 12K',
    zhName: 'BMD URSA 12K',
    sensor: 'Super 35 · 12K',
    prompt: 'shot on Blackmagic URSA Cine 12K with Generation 5 color science, Super 35 12K sensor, rich filmic tones, subtle grain, indie cinema character',
    description: '12K 高分辨率，独立电影常用。',
    useCase: '独立电影、MV、实验影像',
  },
  {
    id: 'canon_c400',
    name: 'Canon EOS C400',
    zhName: '佳能 C400',
    sensor: 'Full Frame · 6K',
    prompt: 'shot on Canon EOS C400 with full-frame back-illuminated sensor, Canon Cinema Gamut, warm natural skin tones, smooth highlight transition, broadcast-ready color',
    description: '佳能色彩科学，暖调肤色，轻量全画幅。',
    useCase: '广告、剧集、婚礼电影',
  },
]);

export const CINEMA_LENSES: readonly CinemaLensProfile[] = Object.freeze([
  {
    id: 'arri_signature_prime',
    name: 'ARRI Signature Prime',
    zhName: '阿莱大师定焦',
    mount: 'LPL · Large Format',
    prompt: 'ARRI Signature Prime lens, large-format coverage, creamy organic bokeh, gentle contrast, smooth highlight rolloff, flattering skin rendering',
    description: '大画幅定焦，奶油虚化，温润对比。',
    useCase: '人物叙事、顶级商业片',
  },
  {
    id: 'cooke_s7i',
    name: 'Cooke S7/i',
    zhName: '库克 S7/i',
    mount: 'PL · Full Frame',
    prompt: 'Cooke S7/i lens with the Cooke Look, warm color bias, gentle contrast, soft rounded bokeh, classic flattering skin tones',
    description: '经典库克味道，暖调、柔焦、讨喜肤色。',
    useCase: '年代戏、人物特写、文艺片',
  },
  {
    id: 'zeiss_supreme_prime',
    name: 'ZEISS Supreme Prime',
    zhName: '蔡司 Supreme',
    mount: 'PL · Full Frame',
    prompt: 'ZEISS Supreme Prime lens, high micro-contrast, precise rendering, clean bokeh, neutral color, modern high-end cinema sharpness',
    description: '高解析、干净利落，现代高端镜头。',
    useCase: '科技广告、产品特写、VFX',
  },
  {
    id: 'panavision_primo70',
    name: 'Panavision Primo 70',
    zhName: '潘那维申 Primo 70',
    mount: 'PV · Large Format',
    prompt: 'Panavision Primo 70 lens, large-format cinema rendering, smooth focus falloff, cinematic bokeh, subtle warmth, luxurious filmic character',
    description: '大画幅电影镜头，柔和过渡、电影感强。',
    useCase: '院线大片、奢华广告',
  },
  {
    id: 'sony_g_master',
    name: 'Sony G Master',
    zhName: '索尼 G 大师',
    mount: 'E · Full Frame',
    prompt: 'Sony G Master lens, modern high-resolution rendering, fast precise focus, clean contrast, smooth background separation, contemporary commercial look',
    description: '现代高解析，干净锐利，商业片常用。',
    useCase: '商业摄影、时尚、产品',
  },
  {
    id: 'canon_cn_e',
    name: 'Canon CN-E Prime',
    zhName: '佳能 CN-E 定焦',
    mount: 'EF · Full Frame',
    prompt: 'Canon CN-E cinema prime lens, warm color rendition, smooth focus rolloff, gentle contrast, natural skin tones, broadcast-friendly look',
    description: '暖调肤色，过渡柔和，广播与广告常用。',
    useCase: '广告、剧集、婚礼',
  },
  {
    id: 'atlas_orion_anamorphic',
    name: 'Atlas Orion Anamorphic',
    zhName: 'Atlas Orion 变形',
    mount: 'PL · Anamorphic',
    prompt: 'Atlas Orion anamorphic lens, 2.39:1 widescreen framing, oval bokeh, subtle blue horizontal flares, gentle edge falloff, modern anamorphic character',
    description: '宽银幕变形镜，椭圆虚化与蓝色光晕。',
    useCase: '科幻、夜戏、风格化广告',
  },
  {
    id: 'leica_summilux_c',
    name: 'Leica Summilux-C',
    zhName: '徕卡 Summilux-C',
    mount: 'PL · Super 35',
    prompt: 'Leica Summilux-C lens, rich color saturation, gentle highlight glow, smooth rounded bokeh, refined vintage-modern cinema character',
    description: '浓郁色彩与柔和光晕，复古又现代。',
    useCase: '年代戏、怀旧 MV、文艺片',
  },
]);

export const CINEMA_FOCAL_LENGTHS = Object.freeze(['18mm', '24mm', '35mm', '50mm', '75mm', '85mm', '100mm', '135mm']);
export const CINEMA_APERTURES = Object.freeze(['f/1.4', 'f/1.8', 'f/2.0', 'f/2.8', 'f/4.0', 'f/5.6', 'f/8.0', 'f/11']);

export const DEFAULT_CINEMA_CAMERA_ID = 'arri_alexa_35';
export const DEFAULT_CINEMA_LENS_ID = 'arri_signature_prime';

export function findCinemaCamera(id: string | undefined | null): CinemaCameraProfile | null {
  return CINEMA_CAMERAS.find((item) => item.id === id) ?? null;
}

export function findCinemaLens(id: string | undefined | null): CinemaLensProfile | null {
  return CINEMA_LENSES.find((item) => item.id === id) ?? null;
}

export function composeCinemaPrompt({
  cameraId,
  lensId,
  focalLength = '50mm',
  aperture = 'f/2.8',
}: {
  cameraId: string;
  lensId: string;
  focalLength?: string;
  aperture?: string;
}): string {
  const camera = findCinemaCamera(cameraId) ?? CINEMA_CAMERAS[0]!;
  const lens = findCinemaLens(lensId) ?? CINEMA_LENSES[0]!;
  return [
    camera.prompt,
    lens.prompt,
    `${focalLength} focal length at ${aperture}`,
    'cinematic composition, natural depth of field, controlled highlights, filmic color grade',
  ].join(', ');
}
