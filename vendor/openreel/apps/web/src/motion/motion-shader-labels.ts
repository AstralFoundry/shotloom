import { MOTION_SHADER_LIBRARY, type MotionShaderDef, type MotionShaderParamDef } from "@openreel/core";
import { catalogLabel } from "../../../../../../renderer/src/i18n/index";
import { editorMessage } from "../shotloom-mode";

/** Only canonical bundled definitions own translated labels. Generated content is opaque. */
export function motionShaderName(def: MotionShaderDef): string {
  return MOTION_SHADER_LIBRARY.includes(def)
    ? catalogLabel(def.name, `editor.motion.shader.${def.id}.name`, editorMessage)
    : def.name;
}

export function motionShaderParameterLabel(
  def: MotionShaderDef | undefined,
  param: MotionShaderParamDef,
): string {
  return def && MOTION_SHADER_LIBRARY.includes(def) && def.params.includes(param)
    ? catalogLabel(param.label, `editor.motion.shader.${def.id}.param.${param.name}`, editorMessage)
    : param.label;
}
