import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';
import { readSource } from './helpers/sourceContract.mjs';

const env = await createRendererEnv({ storage: new Map(), withWindow: true });
after(() => env.dispose());
const library = await env.load('utils/cinemaCameraLibrary');
const camera = await env.load('utils/cameraConfig');

test('电影机与镜头库覆盖完整，并给出可用的默认组合', () => {
  assert.equal(library.CINEMA_CAMERAS.length, 8);
  assert.equal(library.CINEMA_LENSES.length, 8);
  assert.ok(library.CINEMA_CAMERAS.every((item) => item.prompt && item.description && item.useCase));
  assert.ok(library.CINEMA_LENSES.every((item) => item.prompt && item.description && item.useCase));
  assert.ok(library.findCinemaCamera(library.DEFAULT_CINEMA_CAMERA_ID));
  assert.ok(library.findCinemaLens(library.DEFAULT_CINEMA_LENS_ID));
});

test('镜头库组合出带传感器、光学风格、焦距和光圈的提示词', () => {
  const prompt = library.composeCinemaPrompt({
    cameraId: 'sony_venice_2',
    lensId: 'atlas_orion_anamorphic',
    focalLength: '35mm',
    aperture: 'f/2.0',
  });
  assert.match(prompt, /Sony Venice 2/);
  assert.match(prompt, /Atlas Orion anamorphic/);
  assert.match(prompt, /35mm focal length at f\/2\.0/);
});

test('相机配置默认带镜头库 ID，旧配置仍回退到通用相机/镜头', () => {
  const defaults = camera.normalizeCameraConfig(camera.DEFAULT_CAMERA_CONFIG);
  assert.equal(defaults.cameraProfileId, library.DEFAULT_CINEMA_CAMERA_ID);
  assert.equal(defaults.lensProfileId, library.DEFAULT_CINEMA_LENS_ID);
  assert.match(camera.applyCameraConfigToPrompt('人物站在窗边', camera.DEFAULT_CAMERA_CONFIG), /ARRI Alexa 35/);
  assert.match(camera.applyCameraConfigToPrompt('人物站在窗边', camera.DEFAULT_CAMERA_CONFIG), /50mm focal length/);

  const legacy = camera.normalizeCameraConfig({ camera: 'ARRI Alexa', lens: 'Zeiss Ultra Prime', focalLength: '50mm', aperture: 'f/2.8' });
  assert.equal(legacy.cameraProfileId, '');
  assert.match(camera.applyCameraConfigToPrompt('人物', legacy), /Camera: ARRI Alexa/);
});

test('相机控制面板使用镜头库而不是四个通用下拉', () => {
  const panel = readSource('renderer/src/app/canvas/CameraControlPanel.tsx');
  const styles = readSource('renderer/styles/canvas.css');
  assert.match(panel, /CINEMA_CAMERAS/);
  assert.match(panel, /CINEMA_LENSES/);
  assert.match(panel, /composeCinemaPrompt/);
  assert.match(panel, /camera-profile-grid/);
  assert.match(panel, /Segmented/);
  assert.match(panel, /camera-prompt-preview/);
  assert.match(styles, /\.camera-profile-grid \{/);
  assert.match(styles, /\.camera-profile-card\.is-active \{/);
});
