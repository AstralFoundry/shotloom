import { editorMessage } from "../../../shotloom-mode";
export interface MoGraphTourStep {
  id: string;
  target: string | null;
  title: string;
  description: string;
  tips?: string[];
  position: "center" | "top" | "bottom" | "left" | "right";
  action?: "highlight" | "demo";
}

export const MOGRAPH_TOUR_STEPS: MoGraphTourStep[] = [
  {
    id: "intro",
    target: null,
    get title() { return editorMessage("editor.tour.motionSteps.intro.title"); },
    get description() { return editorMessage("editor.tour.motionSteps.intro.description"); },
    position: "center",
  },
  {
    id: "keyframes-inspector",
    target: "[data-tour='inspector']",
    get title() { return editorMessage("editor.tour.motionSteps.keyframes-inspector.title"); },
    get description() { return editorMessage("editor.tour.motionSteps.keyframes-inspector.description"); },
    get tips() { return [ editorMessage("editor.tour.motionSteps.keyframes-inspector.tip1"), editorMessage("editor.tour.motionSteps.keyframes-inspector.tip2"), editorMessage("editor.tour.motionSteps.keyframes-inspector.tip3") ]; },
    position: "left",
  },
  {
    id: "keyframes-timeline",
    target: "[data-tour='timeline']",
    get title() { return editorMessage("editor.tour.motionSteps.keyframes-timeline.title"); },
    get description() { return editorMessage("editor.tour.motionSteps.keyframes-timeline.description"); },
    get tips() { return [ editorMessage("editor.tour.motionSteps.keyframes-timeline.tip1"), editorMessage("editor.tour.motionSteps.keyframes-timeline.tip2"), editorMessage("editor.tour.motionSteps.keyframes-timeline.tip3") ]; },
    position: "top",
  },
  {
    id: "keyframe-editor",
    target: "[data-tour='toolbar']",
    get title() { return editorMessage("editor.tour.motionSteps.keyframe-editor.title"); },
    get description() { return editorMessage("editor.tour.motionSteps.keyframe-editor.description"); },
    get tips() { return [ editorMessage("editor.tour.motionSteps.keyframe-editor.tip1"), editorMessage("editor.tour.motionSteps.keyframe-editor.tip2"), editorMessage("editor.tour.motionSteps.keyframe-editor.tip3") ]; },
    position: "bottom",
  },
  {
    id: "motion-path",
    target: "[data-tour='preview']",
    get title() { return editorMessage("editor.tour.motionSteps.motion-path.title"); },
    get description() { return editorMessage("editor.tour.motionSteps.motion-path.description"); },
    get tips() { return [ editorMessage("editor.tour.motionSteps.motion-path.tip1"), editorMessage("editor.tour.motionSteps.motion-path.tip2"), editorMessage("editor.tour.motionSteps.motion-path.tip3"), editorMessage("editor.tour.motionSteps.motion-path.tip4") ]; },
    position: "left",
  },
  {
    id: "particle-effects",
    target: "[data-tour='inspector']",
    get title() { return editorMessage("editor.tour.motionSteps.particle-effects.title"); },
    get description() { return editorMessage("editor.tour.motionSteps.particle-effects.description"); },
    get tips() { return [ editorMessage("editor.tour.motionSteps.particle-effects.tip1"), editorMessage("editor.tour.motionSteps.particle-effects.tip2"), editorMessage("editor.tour.motionSteps.particle-effects.tip3"), editorMessage("editor.tour.motionSteps.particle-effects.tip4") ]; },
    position: "left",
  },
  {
    id: "emphasis-animations",
    target: "[data-tour='inspector']",
    get title() { return editorMessage("editor.tour.motionSteps.emphasis-animations.title"); },
    get description() { return editorMessage("editor.tour.motionSteps.emphasis-animations.description"); },
    get tips() { return [ editorMessage("editor.tour.motionSteps.emphasis-animations.tip1"), editorMessage("editor.tour.motionSteps.emphasis-animations.tip2"), editorMessage("editor.tour.motionSteps.emphasis-animations.tip3") ]; },
    position: "left",
  },
  {
    id: "text-animations",
    target: "[data-tour='inspector']",
    get title() { return editorMessage("editor.tour.motionSteps.text-animations.title"); },
    get description() { return editorMessage("editor.tour.motionSteps.text-animations.description"); },
    get tips() { return [ editorMessage("editor.tour.motionSteps.text-animations.tip1"), editorMessage("editor.tour.motionSteps.text-animations.tip2"), editorMessage("editor.tour.motionSteps.text-animations.tip3") ]; },
    position: "left",
  },
  {
    id: "complete",
    target: null,
    get title() { return editorMessage("editor.tour.motionSteps.complete.title"); },
    get description() { return editorMessage("editor.tour.motionSteps.complete.description"); },
    get tips() { return [ editorMessage("editor.tour.motionSteps.complete.tip1"), editorMessage("editor.tour.motionSteps.complete.tip2"), editorMessage("editor.tour.motionSteps.complete.tip3") ]; },
    position: "center",
  },
];

export const MOGRAPH_TOUR_KEY = "openreel-mograph-tour-complete";
