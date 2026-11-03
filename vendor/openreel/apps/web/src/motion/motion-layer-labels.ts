import { motionShaderParameterLabel } from "./motion-shader-labels";
import {
  getMotionShaderDef,
  parseMotionShaderFillKeyframeProperty,
  parseContentsPropertyId,
  findShapeItem,
  getMotionShapeContents,
  parseMotionShapeModifierKeyframeProperty,
  parseMotionSceneCameraKeyframeProperty,
  parseMotionSceneObjectKeyframeProperty,
  parseMotionMaskPathKeyframeProperty,
  parseMotionMaskKeyframeProperty,
  parseMotionPuppetKeyframeProperty,
  parseMotionEffectKeyframeProperty,
  type BlendMode,
  type MotionLayer,
  type MotionEffect,
  type MotionEffectParameterDescriptor,
} from "@openreel/core";
import { editorMessage } from "../shotloom-mode";

export interface MotionLayerLabelColor {
  readonly name: string;
  readonly color: string;
}

/** AE-inspired, contrast-safe organizational colors for Motion layer labels. */
export const MOTION_LAYER_LABEL_COLORS: readonly MotionLayerLabelColor[] = [
  { name: "Red", color: "#ef6a6a" },
  { name: "Orange", color: "#ed9b4c" },
  { name: "Yellow", color: "#d9bd4a" },
  { name: "Green", color: "#5fba7d" },
  { name: "Teal", color: "#36b8ad" },
  { name: "Blue", color: "#5d91d8" },
  { name: "Indigo", color: "#7776d8" },
  { name: "Violet", color: "#a773d1" },
  { name: "Pink", color: "#dc77a5" },
  { name: "Brown", color: "#a77a62" },
  { name: "Slate", color: "#7d8b9e" },
  { name: "White", color: "#cbd2dc" },
] as const;

const blendLabelKeys = {
  "normal": "editor.motion.layers.blend.normal",
  "multiply": "editor.motion.layers.blend.multiply",
  "screen": "editor.motion.layers.blend.screen",
  "overlay": "editor.motion.layers.blend.overlay",
  "darken": "editor.motion.layers.blend.darken",
  "lighten": "editor.motion.layers.blend.lighten",
  "color-dodge": "editor.motion.layers.blend.color-dodge",
  "color-burn": "editor.motion.layers.blend.color-burn",
  "hard-light": "editor.motion.layers.blend.hard-light",
  "soft-light": "editor.motion.layers.blend.soft-light",
  "difference": "editor.motion.layers.blend.difference",
  "exclusion": "editor.motion.layers.blend.exclusion",
  "hue": "editor.motion.layers.blend.hue",
  "saturation": "editor.motion.layers.blend.saturation",
  "color": "editor.motion.layers.blend.color",
  "luminosity": "editor.motion.layers.blend.luminosity",
  "add": "editor.motion.layers.blend.add",
  "linear-dodge": "editor.motion.layers.blend.linear-dodge"
} as const;

export function motionBlendModeLabel(mode: BlendMode): string {
  return editorMessage(blendLabelKeys[mode]);
}

const propertyLabelKeys: Record<string, Parameters<typeof editorMessage>[0]> = {
  "transform.position.x": "editor.motion.timeline.property.transform.position.x",
  "transform.position.y": "editor.motion.timeline.property.transform.position.y",
  "transform.position.z": "editor.motion.timeline.property.transform.position.z",
  "transform.scale.x": "editor.motion.timeline.property.transform.scale.x",
  "transform.scale.y": "editor.motion.timeline.property.transform.scale.y",
  "transform.rotation": "editor.motion.timeline.property.transform.rotation",
  "transform.rotation.x": "editor.motion.timeline.property.transform.rotation.x",
  "transform.rotation.y": "editor.motion.timeline.property.transform.rotation.y",
  "transform.perspective": "editor.motion.timeline.property.transform.perspective",
  "transform.opacity": "editor.motion.timeline.property.transform.opacity",
  "transform.anchor.x": "editor.motion.timeline.property.transform.anchor.x",
  "transform.anchor.y": "editor.motion.timeline.property.transform.anchor.y",
  "transform.borderRadius": "editor.motion.timeline.property.transform.borderRadius",
  "transform.crop.x": "editor.motion.timeline.property.transform.crop.x",
  "transform.crop.y": "editor.motion.timeline.property.transform.crop.y",
  "transform.crop.width": "editor.motion.timeline.property.transform.crop.width",
  "transform.crop.height": "editor.motion.timeline.property.transform.crop.height",
  "audio.volume": "editor.motion.timeline.property.audio.volume",
  "audio.pan": "editor.motion.timeline.property.audio.pan",
  "colorGrade.temperature": "editor.motion.timeline.property.colorGrade.temperature",
  "colorGrade.tint": "editor.motion.timeline.property.colorGrade.tint",
  "shape.width": "editor.motion.timeline.property.shape.width",
  "shape.height": "editor.motion.timeline.property.shape.height",
  "shape.cornerRadius": "editor.motion.timeline.property.shape.cornerRadius",
  "shape.fill.opacity": "editor.motion.timeline.property.shape.fill.opacity",
  "shape.stroke.width": "editor.motion.timeline.property.shape.stroke.width",
  "shape.stroke.opacity": "editor.motion.timeline.property.shape.stroke.opacity",
  "shape.stroke.dashOffset": "editor.motion.timeline.property.shape.stroke.dashOffset",
  "shape.gradient.angle": "editor.motion.timeline.property.shape.gradient.angle",
  "composition.time": "editor.motion.timeline.property.composition.time",
  "particle.emissionRate": "editor.motion.timeline.property.particle.emissionRate",
  "particle.maxParticles": "editor.motion.timeline.property.particle.maxParticles",
  "particle.lifetime": "editor.motion.timeline.property.particle.lifetime",
  "particle.speed": "editor.motion.timeline.property.particle.speed",
  "particle.spread": "editor.motion.timeline.property.particle.spread",
  "particle.gravity": "editor.motion.timeline.property.particle.gravity",
  "particle.size": "editor.motion.timeline.property.particle.size",
  "particle.sizeRandomness": "editor.motion.timeline.property.particle.sizeRandomness",
  "particle.opacityStart": "editor.motion.timeline.property.particle.opacityStart",
  "particle.opacityEnd": "editor.motion.timeline.property.particle.opacityEnd"
};


/** Localize display labels from stable property IDs; stored names are opaque values. */
export function motionPropertyLabel(
  property: string | null,
  fallback?: string,
  layer?: MotionLayer,
): string {
  if (!property) return fallback ?? "";
  const key = Object.hasOwn(propertyLabelKeys, property) ? propertyLabelKeys[property] : undefined;
  if (key) return editorMessage(key);
  if (layer) {
    const maskPath = parseMotionMaskPathKeyframeProperty(property);
    const maskProperty = parseMotionMaskKeyframeProperty(property);
    const maskId = maskPath?.maskId ?? maskProperty?.maskId;
    const mask = layer.masks?.find(item => item.id === maskId);
    if (mask) {
      const field = maskPath ? "path" : maskProperty!.property;
      return editorMessage(maskLabelKeys[field], { name: mask.name });
    }
    const pinProperty = parseMotionPuppetKeyframeProperty(property);
    const pin = pinProperty && layer.type === "shape"
      ? layer.puppetPins?.find(item => item.id === pinProperty.pinId) : undefined;
    if (pin && pinProperty) {
      return editorMessage(pinLabelKeys[pinProperty.property], { name: pin.name });
    }
    const contentsProperty = parseContentsPropertyId(property);
    if (contentsProperty && layer.type === "shape") {
      const item = findShapeItem(getMotionShapeContents(layer), contentsProperty.itemId);
      const channel = contentsProperty.channel;
      if (item?.kind === "path" && channel.type === "pathData") {
        return editorMessage("editor.motion.dynamic.contents.path", { name: item.name });
      }
      if (item?.kind === "group") {
        if (channel.type === "transform") {
          return editorMessage(contentsTransformLabelKeys[channel.field], { name: item.name });
        }
        if (channel.type === "operator") {
          const operator = item.operators?.find(entry => entry.id === channel.operatorId);
          const id = operator && `${operator.type}.${channel.param}`;
          if (operator && id && Object.hasOwn(contentsOperatorLabelKeys, id)) {
            return editorMessage(contentsOperatorLabelKeys[id as keyof typeof contentsOperatorLabelKeys], {
              group: item.name, name: operator.name,
            });
          }
        }
      }
    }
    const modifierProperty = parseMotionShapeModifierKeyframeProperty(property);
    const modifier = modifierProperty && layer.type === "shape"
      ? layer.modifiers?.find(item => item.id === modifierProperty.modifierId) : undefined;
    if (modifier && modifierProperty) {
      const id = `${modifier.type}.${modifierProperty.property}`;
      if (Object.hasOwn(modifierLabelKeys, id)) {
        return editorMessage(modifierLabelKeys[id as keyof typeof modifierLabelKeys], { name: modifier.name });
      }
    }
    if (layer.type === "scene3d") {
      const cameraProperty = parseMotionSceneCameraKeyframeProperty(property);
      if (cameraProperty) return editorMessage(sceneCameraLabelKeys[cameraProperty.property]);
      const objectProperty = parseMotionSceneObjectKeyframeProperty(property);
      const object = objectProperty && layer.objects?.find(item => item.id === objectProperty.objectId);
      if (object && objectProperty) {
        return editorMessage(sceneObjectLabelKeys[objectProperty.property], { name: object.name ?? object.id });
      }
    }
    const shaderFillProperty = parseMotionShaderFillKeyframeProperty(property);
    if (shaderFillProperty) {
      const shader = shaderFillProperty.surface === "shape" && layer.type === "shape"
        ? layer.style.fill.shader
        : shaderFillProperty.surface === "text" && layer.type === "text" ? layer.style.fillShader : undefined;
      const def = shader && getMotionShaderDef(shader.shaderId);
      const param = def?.params.find(entry => entry.name === shaderFillProperty.param);
      if (param) return motionShaderParameterLabel(def, param);
    }
    const effectProperty = parseMotionEffectKeyframeProperty(property);
    const effect = effectProperty && layer.effects?.find(item => item.id === effectProperty.effectId);
    if (effect && effectProperty) {
      if (effect.type === "shader") {
        const def = getMotionShaderDef(effect.shaderId);
        const param = def?.params.find(entry => entry.name === effectProperty.param);
        if (param) return editorMessage("editor.motion.shader.effectParameter", {
          name: effect.name, parameter: motionShaderParameterLabel(def, param),
        });
      }
      const id = `${effect.type}.${effectProperty.param}`;
      if (Object.hasOwn(effectLabelKeys, id)) {
        return editorMessage(effectLabelKeys[id as keyof typeof effectLabelKeys], { name: effect.name });
      }
    }
  }
  return fallback ?? property;
}

const maskLabelKeys = {
  "x": "editor.motion.dynamic.mask.x",
  "y": "editor.motion.dynamic.mask.y",
  "width": "editor.motion.dynamic.mask.width",
  "height": "editor.motion.dynamic.mask.height",
  "rotation": "editor.motion.dynamic.mask.rotation",
  "expansion": "editor.motion.dynamic.mask.expansion",
  "feather": "editor.motion.dynamic.mask.feather",
  "opacity": "editor.motion.dynamic.mask.opacity",
  "path": "editor.motion.dynamic.mask.path"
} as const;

const pinLabelKeys = {
  "position.x": "editor.motion.dynamic.pin.position.x",
  "position.y": "editor.motion.dynamic.pin.position.y",
  "radius": "editor.motion.dynamic.pin.radius",
  "strength": "editor.motion.dynamic.pin.strength"
} as const;

const effectLabelKeys = {
  "blur.radius": "editor.motion.dynamic.effect.blur.radius",
  "drop-shadow.opacity": "editor.motion.dynamic.effect.drop-shadow.opacity",
  "drop-shadow.blur": "editor.motion.dynamic.effect.drop-shadow.blur",
  "drop-shadow.offsetX": "editor.motion.dynamic.effect.drop-shadow.offsetX",
  "drop-shadow.offsetY": "editor.motion.dynamic.effect.drop-shadow.offsetY",
  "glow.intensity": "editor.motion.dynamic.effect.glow.intensity",
  "glow.radius": "editor.motion.dynamic.effect.glow.radius",
  "color-adjust.brightness": "editor.motion.dynamic.effect.color-adjust.brightness",
  "color-adjust.contrast": "editor.motion.dynamic.effect.color-adjust.contrast",
  "color-adjust.saturation": "editor.motion.dynamic.effect.color-adjust.saturation",
  "color-adjust.hue": "editor.motion.dynamic.effect.color-adjust.hue",
  "invert.amount": "editor.motion.dynamic.effect.invert.amount",
  "grayscale.amount": "editor.motion.dynamic.effect.grayscale.amount",
  "sepia.amount": "editor.motion.dynamic.effect.sepia.amount",
  "levels.inputBlack": "editor.motion.dynamic.effect.levels.inputBlack",
  "levels.inputWhite": "editor.motion.dynamic.effect.levels.inputWhite",
  "levels.gamma": "editor.motion.dynamic.effect.levels.gamma",
  "levels.outputBlack": "editor.motion.dynamic.effect.levels.outputBlack",
  "levels.outputWhite": "editor.motion.dynamic.effect.levels.outputWhite",
  "sharpen.amount": "editor.motion.dynamic.effect.sharpen.amount",
  "posterize.levels": "editor.motion.dynamic.effect.posterize.levels",
  "directional-blur.angle": "editor.motion.dynamic.effect.directional-blur.angle",
  "directional-blur.distance": "editor.motion.dynamic.effect.directional-blur.distance",
  "noise.amount": "editor.motion.dynamic.effect.noise.amount",
  "noise.seed": "editor.motion.dynamic.effect.noise.seed",
  "radial-blur.centerX": "editor.motion.dynamic.effect.radial-blur.centerX",
  "radial-blur.centerY": "editor.motion.dynamic.effect.radial-blur.centerY",
  "radial-blur.amount": "editor.motion.dynamic.effect.radial-blur.amount",
  "displace.amount": "editor.motion.dynamic.effect.displace.amount",
  "displace.scale": "editor.motion.dynamic.effect.displace.scale",
  "displace.seed": "editor.motion.dynamic.effect.displace.seed",
  "threshold.level": "editor.motion.dynamic.effect.threshold.level",
  "mosaic.blockSize": "editor.motion.dynamic.effect.mosaic.blockSize",
  "chromatic-aberration.amount": "editor.motion.dynamic.effect.chromatic-aberration.amount",
  "chromatic-aberration.angle": "editor.motion.dynamic.effect.chromatic-aberration.angle",
  "vignette.amount": "editor.motion.dynamic.effect.vignette.amount",
  "vignette.softness": "editor.motion.dynamic.effect.vignette.softness",
  "backdrop-blur.radius": "editor.motion.dynamic.effect.backdrop-blur.radius",
  "slider-control.value": "editor.motion.dynamic.effect.slider-control.value",
  "checkbox-control.value": "editor.motion.dynamic.effect.checkbox-control.value",
  "angle-control.value": "editor.motion.dynamic.effect.angle-control.value"
} as const;

const modifierLabelKeys = {
  "trim-paths.start": "editor.motion.dynamic.modifier.trim-paths.start",
  "trim-paths.end": "editor.motion.dynamic.modifier.trim-paths.end",
  "trim-paths.offset": "editor.motion.dynamic.modifier.trim-paths.offset",
  "repeater.copies": "editor.motion.dynamic.modifier.repeater.copies",
  "repeater.offset": "editor.motion.dynamic.modifier.repeater.offset",
  "repeater.position.x": "editor.motion.dynamic.modifier.repeater.position.x",
  "repeater.position.y": "editor.motion.dynamic.modifier.repeater.position.y",
  "repeater.scale.x": "editor.motion.dynamic.modifier.repeater.scale.x",
  "repeater.scale.y": "editor.motion.dynamic.modifier.repeater.scale.y",
  "repeater.rotation": "editor.motion.dynamic.modifier.repeater.rotation",
  "repeater.opacity": "editor.motion.dynamic.modifier.repeater.opacity",
  "zig-zag.size": "editor.motion.dynamic.modifier.zig-zag.size",
  "zig-zag.ridgesPerSegment": "editor.motion.dynamic.modifier.zig-zag.ridgesPerSegment",
  "round-corners.radius": "editor.motion.dynamic.modifier.round-corners.radius",
  "round-corners.segments": "editor.motion.dynamic.modifier.round-corners.segments",
  "wiggle-paths.size": "editor.motion.dynamic.modifier.wiggle-paths.size",
  "wiggle-paths.detail": "editor.motion.dynamic.modifier.wiggle-paths.detail",
  "wiggle-paths.speed": "editor.motion.dynamic.modifier.wiggle-paths.speed",
  "wiggle-paths.seed": "editor.motion.dynamic.modifier.wiggle-paths.seed",
  "offset-paths.amount": "editor.motion.dynamic.modifier.offset-paths.amount",
  "pucker-bloat.amount": "editor.motion.dynamic.modifier.pucker-bloat.amount",
  "twist.angle": "editor.motion.dynamic.modifier.twist.angle"
} as const;

const sceneCameraLabelKeys = {
  "position.x": "editor.motion.dynamic.sceneCamera.position.x",
  "position.y": "editor.motion.dynamic.sceneCamera.position.y",
  "position.z": "editor.motion.dynamic.sceneCamera.position.z",
  "target.x": "editor.motion.dynamic.sceneCamera.target.x",
  "target.y": "editor.motion.dynamic.sceneCamera.target.y",
  "target.z": "editor.motion.dynamic.sceneCamera.target.z",
  "fov": "editor.motion.dynamic.sceneCamera.fov",
  "near": "editor.motion.dynamic.sceneCamera.near",
  "far": "editor.motion.dynamic.sceneCamera.far"
} as const;

const sceneObjectLabelKeys = {
  "position.x": "editor.motion.dynamic.sceneObject.position.x",
  "position.y": "editor.motion.dynamic.sceneObject.position.y",
  "position.z": "editor.motion.dynamic.sceneObject.position.z",
  "rotation.x": "editor.motion.dynamic.sceneObject.rotation.x",
  "rotation.y": "editor.motion.dynamic.sceneObject.rotation.y",
  "rotation.z": "editor.motion.dynamic.sceneObject.rotation.z",
  "scale.x": "editor.motion.dynamic.sceneObject.scale.x",
  "scale.y": "editor.motion.dynamic.sceneObject.scale.y",
  "scale.z": "editor.motion.dynamic.sceneObject.scale.z",
  "opacity": "editor.motion.dynamic.sceneObject.opacity",
  "lid.angle": "editor.motion.dynamic.sceneObject.lid.angle"
} as const;

const contentsTransformLabelKeys = {
  "positionX": "editor.motion.dynamic.contents.transform.positionX",
  "positionY": "editor.motion.dynamic.contents.transform.positionY",
  "scaleX": "editor.motion.dynamic.contents.transform.scaleX",
  "scaleY": "editor.motion.dynamic.contents.transform.scaleY",
  "rotation": "editor.motion.dynamic.contents.transform.rotation",
  "opacity": "editor.motion.dynamic.contents.transform.opacity"
} as const;

const contentsOperatorLabelKeys = {
  "trim-paths.start": "editor.motion.dynamic.contents.operator.trim-paths.start",
  "trim-paths.end": "editor.motion.dynamic.contents.operator.trim-paths.end",
  "trim-paths.offset": "editor.motion.dynamic.contents.operator.trim-paths.offset",
  "repeater.copies": "editor.motion.dynamic.contents.operator.repeater.copies",
  "repeater.offset": "editor.motion.dynamic.contents.operator.repeater.offset",
  "repeater.position.x": "editor.motion.dynamic.contents.operator.repeater.position.x",
  "repeater.position.y": "editor.motion.dynamic.contents.operator.repeater.position.y",
  "repeater.scale.x": "editor.motion.dynamic.contents.operator.repeater.scale.x",
  "repeater.scale.y": "editor.motion.dynamic.contents.operator.repeater.scale.y",
  "repeater.rotation": "editor.motion.dynamic.contents.operator.repeater.rotation",
  "repeater.opacity": "editor.motion.dynamic.contents.operator.repeater.opacity",
  "zig-zag.size": "editor.motion.dynamic.contents.operator.zig-zag.size",
  "zig-zag.ridgesPerSegment": "editor.motion.dynamic.contents.operator.zig-zag.ridgesPerSegment",
  "round-corners.radius": "editor.motion.dynamic.contents.operator.round-corners.radius",
  "round-corners.segments": "editor.motion.dynamic.contents.operator.round-corners.segments",
  "wiggle-paths.size": "editor.motion.dynamic.contents.operator.wiggle-paths.size",
  "wiggle-paths.detail": "editor.motion.dynamic.contents.operator.wiggle-paths.detail",
  "wiggle-paths.speed": "editor.motion.dynamic.contents.operator.wiggle-paths.speed",
  "wiggle-paths.seed": "editor.motion.dynamic.contents.operator.wiggle-paths.seed",
  "offset-paths.amount": "editor.motion.dynamic.contents.operator.offset-paths.amount",
  "pucker-bloat.amount": "editor.motion.dynamic.contents.operator.pucker-bloat.amount",
  "twist.angle": "editor.motion.dynamic.contents.operator.twist.angle"
} as const;

// Display labels only: descriptor ranges, units and parameter identifiers stay upstream-owned.
export function motionEffectParameterLabel(
  effect: Pick<MotionEffect, "type">,
  descriptor: MotionEffectParameterDescriptor,
): string {
  const id = `${effect.type}.${descriptor.param}`;
  return Object.hasOwn(effectParameterLabelKeys, id)
    ? editorMessage(effectParameterLabelKeys[id as keyof typeof effectParameterLabelKeys])
    : descriptor.label;
}

const effectParameterLabelKeys = {
  "blur.radius": "editor.motion.effectParameter.blur.radius",
  "drop-shadow.opacity": "editor.motion.effectParameter.drop-shadow.opacity",
  "drop-shadow.blur": "editor.motion.effectParameter.drop-shadow.blur",
  "drop-shadow.offsetX": "editor.motion.effectParameter.drop-shadow.offsetX",
  "drop-shadow.offsetY": "editor.motion.effectParameter.drop-shadow.offsetY",
  "glow.intensity": "editor.motion.effectParameter.glow.intensity",
  "glow.radius": "editor.motion.effectParameter.glow.radius",
  "color-adjust.brightness": "editor.motion.effectParameter.color-adjust.brightness",
  "color-adjust.contrast": "editor.motion.effectParameter.color-adjust.contrast",
  "color-adjust.saturation": "editor.motion.effectParameter.color-adjust.saturation",
  "color-adjust.hue": "editor.motion.effectParameter.color-adjust.hue",
  "invert.amount": "editor.motion.effectParameter.invert.amount",
  "grayscale.amount": "editor.motion.effectParameter.grayscale.amount",
  "sepia.amount": "editor.motion.effectParameter.sepia.amount",
  "levels.inputBlack": "editor.motion.effectParameter.levels.inputBlack",
  "levels.inputWhite": "editor.motion.effectParameter.levels.inputWhite",
  "levels.gamma": "editor.motion.effectParameter.levels.gamma",
  "levels.outputBlack": "editor.motion.effectParameter.levels.outputBlack",
  "levels.outputWhite": "editor.motion.effectParameter.levels.outputWhite",
  "sharpen.amount": "editor.motion.effectParameter.sharpen.amount",
  "posterize.levels": "editor.motion.effectParameter.posterize.levels",
  "directional-blur.angle": "editor.motion.effectParameter.directional-blur.angle",
  "directional-blur.distance": "editor.motion.effectParameter.directional-blur.distance",
  "noise.amount": "editor.motion.effectParameter.noise.amount",
  "noise.seed": "editor.motion.effectParameter.noise.seed",
  "radial-blur.centerX": "editor.motion.effectParameter.radial-blur.centerX",
  "radial-blur.centerY": "editor.motion.effectParameter.radial-blur.centerY",
  "radial-blur.amount": "editor.motion.effectParameter.radial-blur.amount",
  "displace.amount": "editor.motion.effectParameter.displace.amount",
  "displace.scale": "editor.motion.effectParameter.displace.scale",
  "displace.seed": "editor.motion.effectParameter.displace.seed",
  "threshold.level": "editor.motion.effectParameter.threshold.level",
  "mosaic.blockSize": "editor.motion.effectParameter.mosaic.blockSize",
  "chromatic-aberration.amount": "editor.motion.effectParameter.chromatic-aberration.amount",
  "chromatic-aberration.angle": "editor.motion.effectParameter.chromatic-aberration.angle",
  "vignette.amount": "editor.motion.effectParameter.vignette.amount",
  "vignette.softness": "editor.motion.effectParameter.vignette.softness",
  "backdrop-blur.radius": "editor.motion.effectParameter.backdrop-blur.radius",
  "slider-control.value": "editor.motion.effectParameter.slider-control.value",
  "checkbox-control.value": "editor.motion.effectParameter.checkbox-control.value",
  "angle-control.value": "editor.motion.effectParameter.angle-control.value",
} as const;
