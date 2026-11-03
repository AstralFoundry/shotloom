import { configureShotloomLocale } from "../../shotloom-mode";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  DEFAULT_MOTION_TRANSFORM,
  type MotionComposition,
  type MotionTextLayer,
} from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { PropertiesPanel } from "./PropertiesPanel";

const LAYER_ID = "layer-text";
const COMP_ID = "comp-text-metrics";

function textLayer(): MotionTextLayer {
  return {
    id: LAYER_ID,
    type: "text",
    name: "Title",
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    text: "HELLO",
    style: {
      fontFamily: "Inter",
      fontSize: 120,
      fontWeight: 700,
      color: "#ffffff",
      align: "center",
    },
  };
}

function composition(): MotionComposition {
  return {
    id: COMP_ID,
    name: "Comp",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 4,
    backgroundColor: "#101820",
    layers: [textLayer()],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function storedComposition(): MotionComposition {
  const project = useProjectStore.getState().project;
  const found = (project.motionCompositions ?? []).find(
    (entry) => entry.id === COMP_ID,
  );
  if (!found) throw new Error("composition not stored");
  return found;
}

function storedTextLayer(): MotionTextLayer {
  return storedComposition().layers[0] as MotionTextLayer;
}

function fieldSpinbutton(label: string): HTMLElement {
  const field = screen
    .getAllByText(label)
    .map((node) => node.closest(".astryx-field") as HTMLElement | null)
    .find(
      (candidate): candidate is HTMLElement =>
        candidate !== null &&
        within(candidate).queryByRole("spinbutton") !== null,
    );
  if (!field) throw new Error(`field not found: ${label}`);
  return within(field).getByRole("spinbutton");
}

describe.each(["en-US", "zh-CN"] as const)("PropertiesPanel text metrics (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    const project = {
      ...createEmptyProject("Text metrics test"),
      motionCompositions: [composition()],
    };
    useProjectStore.setState({ hasOpenProject: true, project });
    useMotionStore.setState({
      selectedLayerId: LAYER_ID,
      selectedLayerIds: [LAYER_ID],
      selectedLightId: null,
      rightTab: "properties",
      playhead: 0,
      autoKeyframe: false,
    });
  });

  afterEach(() => {
    configureShotloomLocale("en-US");
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("writes tracking, leading and box width via the store", async () => {
    render(<PropertiesPanel composition={composition()} />);

    fireEvent.change(fieldSpinbutton(ui("Tracking", "字距")), { target: { value: "12" } });
    await waitFor(() => {
      expect(storedTextLayer().style.letterSpacing).toBe(12);
    });

    fireEvent.change(fieldSpinbutton(ui("Leading", "行距")), { target: { value: "1.4" } });
    await waitFor(() => {
      expect(storedTextLayer().style.lineHeight).toBe(1.4);
    });

    fireEvent.change(fieldSpinbutton(ui("Box width", "文本框宽度")), {
      target: { value: "600" },
    });
    await waitFor(() => {
      expect(storedTextLayer().style.maxWidth).toBe(600);
    });
  });

  it("clears box width to undefined when set to zero", async () => {
    const seeded = composition();
    (seeded.layers[0] as MotionTextLayer) = {
      ...(seeded.layers[0] as MotionTextLayer),
      style: {
        ...(seeded.layers[0] as MotionTextLayer).style,
        maxWidth: 600,
      },
    };
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...createEmptyProject("Text metrics clear"),
        motionCompositions: [seeded],
      },
    });

    render(<PropertiesPanel composition={seeded} />);

    fireEvent.change(fieldSpinbutton(ui("Box width", "文本框宽度")), { target: { value: "0" } });
    await waitFor(() => {
      expect(storedTextLayer().style.maxWidth).toBeUndefined();
    });
  });

  it("writes stroke width via the store", async () => {
    render(<PropertiesPanel composition={composition()} />);

    fireEvent.change(fieldSpinbutton(ui("Stroke width", "描边宽度")), {
      target: { value: "4" },
    });
    await waitFor(() => {
      expect(storedTextLayer().style.stroke).toEqual({
        color: "#000000",
        width: 4,
      });
    });
  });

  it("clears stroke when width is set to zero", async () => {
    const seeded = composition();
    (seeded.layers[0] as MotionTextLayer) = {
      ...(seeded.layers[0] as MotionTextLayer),
      style: {
        ...(seeded.layers[0] as MotionTextLayer).style,
        stroke: { color: "#ff0000", width: 4 },
      },
    };
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...createEmptyProject("Text stroke clear"),
        motionCompositions: [seeded],
      },
    });

    render(<PropertiesPanel composition={seeded} />);

    fireEvent.change(fieldSpinbutton(ui("Stroke width", "描边宽度")), {
      target: { value: "0" },
    });
    await waitFor(() => {
      expect(storedTextLayer().style.stroke).toBeUndefined();
    });
  });
  it("keeps font identities and numeric weight values when labels are localized", async () => {
    render(<PropertiesPanel composition={composition()} />);
    expect(screen.getByText("Title")).toHaveAttribute("data-shotloom-user-content", "");
    const weight = screen.getByRole("combobox", { name: ui("Font weight", "字重") });
    expect(within(weight).getByRole("option", { name: ui("Bold", "粗体") })).toHaveValue("700");
    fireEvent.change(weight, { target: { value: "500" } });
    await waitFor(() => expect(storedTextLayer().style.fontWeight).toBe(500));
    const family = screen.getByRole("combobox", { name: ui("Font family", "字体") });
    expect(within(family).getByRole("option", { name: "Inter" })).toHaveAttribute("data-shotloom-user-content", "");
    fireEvent.change(family, { target: { value: "Georgia" } });
    await waitFor(() => expect(storedTextLayer().style.fontFamily).toBe("Georgia"));
    expect(storedTextLayer().name).toBe("Title");
    expect(storedTextLayer().text).toBe("HELLO");
    expect(storedTextLayer().id).toBe(LAYER_ID);
  });

});
