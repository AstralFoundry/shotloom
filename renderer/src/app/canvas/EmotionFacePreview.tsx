import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

import { t } from '@/i18n';
import { emotionBlendshapes, type ImageEmotionPreset } from '@/domain/graph/imageEmotion';

/** three.js 示例的 face-cap 模型（MIT），已去掉贴图，只保留几何与 52 个 ARKit morph target。 */
const MODEL_URL = './models/facecap-mannequin.glb';
const MORPH_DURATION = 220;

type Rig = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  meshes: THREE.Mesh[];
  frame: number | null;
};

function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry?.dispose();
    const material = object.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material?.dispose?.();
  });
}

function applyMorphTargets(rig: Rig, targets: Record<string, number>, animate: boolean) {
  if (rig.frame) cancelAnimationFrame(rig.frame);
  const starts = rig.meshes.map((mesh) => [...(mesh.morphTargetInfluences || [])]);
  const apply = (progress: number) => {
    const eased = 1 - Math.pow(1 - progress, 3);
    rig.meshes.forEach((mesh, meshIndex) => {
      const dictionary = mesh.morphTargetDictionary || {};
      const influences = mesh.morphTargetInfluences || [];
      Object.entries(dictionary).forEach(([name, index]) => {
        const target = targets[name] ?? 0;
        const start = starts[meshIndex]?.[index] ?? 0;
        influences[index] = start + (target - start) * eased;
      });
    });
    rig.renderer.render(rig.scene, rig.camera);
  };
  if (!animate) {
    apply(1);
    return;
  }
  const start = performance.now();
  const tick = (now: number) => {
    const progress = Math.min(1, (now - start) / MORPH_DURATION);
    apply(progress);
    rig.frame = progress < 1 ? requestAnimationFrame(tick) : null;
  };
  rig.frame = requestAnimationFrame(tick);
}

/**
 * 情绪面板的 3D 脸部预览：真实模特脸 + ARKit blendshape。
 * 只在面板打开时创建 WebGL 上下文，关闭即 dispose；模型与 three 走独立 chunk，不拖慢主界面。
 */
export default function EmotionFacePreview({ preset }: { preset: ImageEmotionPreset }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rigRef = useRef<Rig | null>(null);
  const presetRef = useRef(preset);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  presetRef.current = preset;

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    let disposed = false;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      setStatus('error');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x26272a);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 20);
    camera.position.set(0, 0.05, 3.15);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.82));
    const key = new THREE.DirectionalLight(0xffffff, 1.45);
    key.position.set(-2.8, 4, 3);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xc9d0dc, 0.5);
    fill.position.set(3, 1, 2);
    scene.add(fill);

    const rig: Rig = { renderer, scene, camera, meshes: [], frame: null };
    rigRef.current = rig;
    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(MODEL_URL, (gltf) => {
      if (disposed) {
        disposeObject(gltf.scene);
        return;
      }
      const model = gltf.scene;
      const material = new THREE.MeshStandardMaterial({ color: 0xaaacae, roughness: 0.9, metalness: 0.01 });
      model.traverse((object) => {
        if (object instanceof THREE.Mesh) object.material = material;
      });
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      model.scale.multiplyScalar(2.35 / Math.max(0.001, size.y));
      model.updateMatrixWorld(true);
      const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
      model.position.sub(center);
      scene.add(model);
      rig.meshes = [];
      model.traverse((object) => {
        if (object instanceof THREE.Mesh && object.morphTargetDictionary && object.morphTargetInfluences) rig.meshes.push(object);
      });
      setStatus('ready');
      applyMorphTargets(rig, emotionBlendshapes(presetRef.current), false);
    }, undefined, () => {
      if (!disposed) setStatus('error');
    });

    const onVisibility = () => {
      if (document.visibilityState === 'visible') renderer.render(scene, camera);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      if (rig.frame) cancelAnimationFrame(rig.frame);
      disposeObject(scene);
      renderer.dispose();
      rigRef.current = null;
    };
  }, []);

  useEffect(() => {
    const rig = rigRef.current;
    if (!rig || !rig.meshes.length) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    applyMorphTargets(rig, emotionBlendshapes(preset), !reduced);
  }, [preset]);

  return (
    <div ref={hostRef} className="image-emotion-face-stage">
      <canvas ref={canvasRef} className="image-emotion-face-canvas" aria-hidden="true" />
      {status !== 'ready' && (
        <div className="image-emotion-face-status" role="status">
          {status === 'error' ? t('imageEmotion.facePreviewFailed') : t('imageEmotion.facePreviewLoading')}
        </div>
      )}
    </div>
  );
}
