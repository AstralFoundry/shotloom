import { editorMessage } from "../../../../shotloom-mode";
/** Shared constants and helpers for KieAI model forms */

export const ASPECT_RATIO_OPTIONS = [
  { value: "1:1",  label: "1:1  Square" },
  { value: "4:3",  label: "4:3  Landscape" },
  { value: "3:4",  label: "3:4  Portrait" },
  { value: "16:9", label: "16:9 Wide" },
  { value: "9:16", label: "9:16 Story" },
  { value: "2:3",  label: "2:3  Portrait" },
  { value: "3:2",  label: "3:2  Landscape" },
  { value: "21:9", label: "21:9 Cinematic" },
] as const;

export const ASPECT_RATIO_OPTIONS_AUTO = [
  { value: "auto", label: "Auto" },
  ...ASPECT_RATIO_OPTIONS,
  { value: "1:4",  label: "1:4  Tall" },
  { value: "4:1",  label: "4:1  Wide" },
  { value: "1:8",  label: "1:8  Very Tall" },
  { value: "8:1",  label: "8:1  Very Wide" },
  { value: "4:5",  label: "4:5  Portrait" },
  { value: "5:4",  label: "5:4  Landscape" },
] as const;

export const ASPECT_RATIO_OPTIONS_BASIC = [
  { value: "1:1",  label: "1:1  Square" },
  { value: "4:3",  label: "4:3  Landscape" },
  { value: "3:4",  label: "3:4  Portrait" },
  { value: "16:9", label: "16:9 Wide" },
  { value: "9:16", label: "9:16 Story" },
] as const;

const ratioKeys = {
  "1:1": "editor.imageForm.ratio.1:1",
  "4:3": "editor.imageForm.ratio.4:3",
  "3:4": "editor.imageForm.ratio.3:4",
  "16:9": "editor.imageForm.ratio.16:9",
  "9:16": "editor.imageForm.ratio.9:16",
  "2:3": "editor.imageForm.ratio.2:3",
  "3:2": "editor.imageForm.ratio.3:2",
  "21:9": "editor.imageForm.ratio.21:9",
  "auto": "editor.imageForm.ratio.auto",
  "1:4": "editor.imageForm.ratio.1:4",
  "4:1": "editor.imageForm.ratio.4:1",
  "1:8": "editor.imageForm.ratio.1:8",
  "8:1": "editor.imageForm.ratio.8:1",
  "4:5": "editor.imageForm.ratio.4:5",
  "5:4": "editor.imageForm.ratio.5:4",
} as const;

export function aspectRatioOptions(options: readonly { readonly value: string; readonly label: string }[]) {
  return options.map(option => ({ ...option, label: Object.hasOwn(ratioKeys, option.value)
    ? editorMessage(ratioKeys[option.value as keyof typeof ratioKeys]) : option.label }));
}
