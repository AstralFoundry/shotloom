import { editorMessage } from "../../../shotloom-mode";
export interface TourStep {
  id: string;
  target: string | null;
  title: string;
  description: string;
  tips?: string[];
  position: "center" | "top" | "bottom" | "left" | "right";
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    target: null,
    get title() { return editorMessage("editor.tour.steps.welcome.title"); },
    get description() { return editorMessage("editor.tour.steps.welcome.description"); },
    position: "center",
  },
  {
    id: "assets",
    target: "[data-tour='assets']",
    get title() { return editorMessage("editor.tour.steps.assets.title"); },
    get description() { return editorMessage("editor.tour.steps.assets.description"); },
    get tips() { return [ editorMessage("editor.tour.steps.assets.tip1"), editorMessage("editor.tour.steps.assets.tip2"), editorMessage("editor.tour.steps.assets.tip3"), editorMessage("editor.tour.steps.assets.tip4") ]; },
    position: "right",
  },
  {
    id: "timeline",
    target: "[data-tour='timeline']",
    get title() { return editorMessage("editor.tour.steps.timeline.title"); },
    get description() { return editorMessage("editor.tour.steps.timeline.description"); },
    get tips() { return [ editorMessage("editor.tour.steps.timeline.tip1"), editorMessage("editor.tour.steps.timeline.tip2"), editorMessage("editor.tour.steps.timeline.tip3") ]; },
    position: "top",
  },
  {
    id: "preview",
    target: "[data-tour='preview']",
    get title() { return editorMessage("editor.tour.steps.preview.title"); },
    get description() { return editorMessage("editor.tour.steps.preview.description"); },
    get tips() { return [ editorMessage("editor.tour.steps.preview.tip1"), editorMessage("editor.tour.steps.preview.tip2"), editorMessage("editor.tour.steps.preview.tip3") ]; },
    position: "left",
  },
  {
    id: "inspector",
    target: "[data-tour='inspector']",
    get title() { return editorMessage("editor.tour.steps.inspector.title"); },
    get description() { return editorMessage("editor.tour.steps.inspector.description"); },
    get tips() { return [ editorMessage("editor.tour.steps.inspector.tip1"), editorMessage("editor.tour.steps.inspector.tip2"), editorMessage("editor.tour.steps.inspector.tip3") ]; },
    position: "left",
  },
  {
    id: "complete",
    target: null,
    get title() { return editorMessage("editor.tour.steps.complete.title"); },
    get description() { return editorMessage("editor.tour.steps.complete.description"); },
    position: "center",
  },
];

export const ONBOARDING_KEY = "openreel-onboarding-complete";
