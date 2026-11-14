import { Camera, Color, Scene, Vector2, WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Same optional render chain for viewport, preview sheets and delivered frames. */
export class SceneEffects {
    private composer: EffectComposer;
    private base: RenderPass;
    private ao: SSAOPass;
    private outline: OutlinePass;
    private output: OutputPass;
    private dimensions = ''; 
    constructor(private renderer: WebGLRenderer, scene: Scene, camera: Camera) {
        this.composer = new EffectComposer(renderer);
        this.base = new RenderPass(scene, camera);
        this.ao = new SSAOPass(scene, camera, 1, 1, 16);
        this.ao.kernelRadius = 0.4;
        this.ao.minDistance = 0.001;
        this.ao.maxDistance = 0.1;
        this.outline = new OutlinePass(new Vector2(1, 1), scene, camera);
        this.outline.visibleEdgeColor = new Color('#24282d');
        this.outline.hiddenEdgeColor = new Color('#24282d');
        this.outline.edgeStrength = 2;
        this.outline.edgeThickness = 1;
        this.output = new OutputPass();
        for (const pass of [this.base, this.ao, this.outline, this.output]) this.composer.addPass(pass);
    }
    render(scene: Scene, camera: Camera, ao: boolean, outline: boolean) {
        this.base.scene = scene; this.base.camera = camera;
        this.ao.scene = scene; this.ao.camera = camera;
        this.outline.renderScene = scene; this.outline.renderCamera = camera;
        this.outline.selectedObjects = scene.children.filter(o => o.visible && o.userData.entityId);
        this.ao.enabled = ao; this.outline.enabled = outline;
        const size = this.renderer.getSize(new Vector2());
        const dimensions = `${size.x}:${size.y}:${this.renderer.getPixelRatio()}`;
        if (dimensions !== this.dimensions) {
            this.composer.setPixelRatio(this.renderer.getPixelRatio());
            this.composer.setSize(size.x, size.y);
            this.dimensions = dimensions;
        }
        this.composer.render();
    }
    dispose() {
        for (const pass of [this.base, this.ao, this.outline, this.output]) pass.dispose();
        this.composer.dispose();
    }
}
