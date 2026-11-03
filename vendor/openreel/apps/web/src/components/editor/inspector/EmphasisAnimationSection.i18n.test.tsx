import "../../../test/install-local-storage-mock";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type Project } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { EmphasisAnimationSection } from "./EmphasisAnimationSection";

function projectWithClip(): Project {
  const project = createEmptyProject("Adjustment workflow");
  return {
    ...project,
    timeline: {
      ...project.timeline,
      duration: 8,
      tracks: [{
        id: "video-track",
        type: "video",
        name: "Video",
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
        transitions: [],
        clips: [{
          id: "clip-1",
          mediaId: "media-1",
          trackId: "video-track",
          startTime: 1,
          duration: 4,
          inPoint: 0,
          outPoint: 4,
          transform: {
            position: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            anchor: { x: 0.5, y: 0.5 },
            opacity: 1,
          },
          effects: [],
          audioEffects: [],
          volume: 1,
          keyframes: [],
        }],
      }],
    },
  };
}

describe.each(["en-US", "zh-CN"] as const)("Emphasis animation (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  const animation = () => useProjectStore.getState().getClip("clip-1")?.emphasisAnimation;
  beforeEach(() => {
    configureShotloomLocale(locale);
    useProjectStore.setState({ project: projectWithClip(), hasOpenProject: true });
  });
  afterEach(() => {
    cleanup(); configureShotloomLocale("en-US");
    useProjectStore.setState({ project: createEmptyProject("Reset"), hasOpenProject: false });
  });
  it("displays 25 presets and saves the type, speed and loop", async () => {
    render(<EmphasisAnimationSection clipId="clip-1" />);
    expect(screen.getByText(ui("Attention", "吸引注意"))).toBeInTheDocument();
    expect(screen.getByText(ui("Zoom & Pan", "缩放与平移"))).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(27);
    fireEvent.click(screen.getByRole("button", { name: ui("Pulse", "脉冲") }));
    await waitFor(() => expect(animation()?.type).toBe("pulse"));
    expect(screen.getByText(ui("Gentle scale breathing effect", "轻柔的缩放呼吸效果"))).toBeInTheDocument();
    expect(screen.getByText(ui("Clip: 4.0s", "片段：4.0秒"))).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("slider", { name: ui("Speed", "速度") }), { key: "ArrowRight" });
    await waitFor(() => expect(animation()?.speed).toBeCloseTo(1.1));
    fireEvent.click(screen.getByRole("switch", { name: ui("Loop Animation", "循环动画") }));
    await waitFor(() => expect(animation()?.loop).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: ui("Reset", "重置") }));
    await waitFor(() => expect(animation()?.type).toBe("none"));
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });
  it("selects every localized preset and retains all protocol values", async () => {
    render(<EmphasisAnimationSection clipId="clip-1" />);
    const presets = [
    [
        "pulse",
        "Pulse",
        "脉冲",
        "Gentle scale breathing effect",
        "轻柔的缩放呼吸效果"
    ],
    [
        "heartbeat",
        "Heartbeat",
        "心跳",
        "Double-beat pulse like a heart",
        "模拟心跳的双拍脉冲"
    ],
    [
        "flash",
        "Flash",
        "闪光",
        "Opacity pulsing effect",
        "不透明度脉冲效果"
    ],
    [
        "glow",
        "Glow",
        "发光",
        "Scale and opacity pulse",
        "缩放与不透明度脉冲"
    ],
    [
        "breathe",
        "Breathe",
        "呼吸",
        "Slow, calming scale effect",
        "缓慢舒缓的缩放效果"
    ],
    [
        "shake",
        "Shake",
        "抖动",
        "Quick side-to-side shake",
        "快速左右抖动"
    ],
    [
        "bounce",
        "Bounce",
        "弹跳",
        "Bouncing up and down",
        "上下弹跳"
    ],
    [
        "float",
        "Float",
        "漂浮",
        "Gentle floating motion",
        "轻柔漂浮运动"
    ],
    [
        "vibrate",
        "Vibrate",
        "震动",
        "Random small movements",
        "随机小幅移动"
    ],
    [
        "wave",
        "Wave",
        "波浪",
        "Wave-like motion",
        "波浪般的运动"
    ],
    [
        "spin",
        "Spin",
        "旋转",
        "Continuous rotation",
        "持续旋转"
    ],
    [
        "swing",
        "Swing",
        "摆动",
        "Pendulum-like rotation",
        "钟摆般的旋转"
    ],
    [
        "wobble",
        "Wobble",
        "摇晃",
        "Wobbling with rotation",
        "伴随旋转的摇晃"
    ],
    [
        "tilt",
        "Tilt",
        "倾斜",
        "Slow tilting motion",
        "缓慢倾斜运动"
    ],
    [
        "tada",
        "Tada",
        "欢呼",
        "Attention-grabbing wiggle",
        "吸引注意的摆动"
    ],
    [
        "jello",
        "Jello",
        "果冻",
        "Jelly-like squish effect",
        "果冻般的挤压效果"
    ],
    [
        "rubber-band",
        "Rubber Band",
        "橡皮筋",
        "Stretchy rubber effect",
        "橡皮筋般的拉伸效果"
    ],
    [
        "flicker",
        "Flicker",
        "闪烁",
        "Random visibility flicker",
        "随机闪烁显隐"
    ],
    [
        "zoom-pulse",
        "Zoom Pulse",
        "缩放脉冲",
        "Scale in and out",
        "放大与缩小"
    ],
    [
        "focus-zoom",
        "Focus Zoom",
        "焦点缩放",
        "Zoom to point and back",
        "缩放至焦点后返回"
    ],
    [
        "ken-burns",
        "Ken Burns",
        "缓慢推移",
        "Slow zoom with pan",
        "缓慢缩放并平移"
    ],
    [
        "pan-left",
        "Pan Left",
        "向左平移",
        "Slow pan to the left",
        "缓慢向左平移"
    ],
    [
        "pan-right",
        "Pan Right",
        "向右平移",
        "Slow pan to the right",
        "缓慢向右平移"
    ],
    [
        "pan-up",
        "Pan Up",
        "向上平移",
        "Slow pan upward",
        "缓慢向上平移"
    ],
    [
        "pan-down",
        "Pan Down",
        "向下平移",
        "Slow pan downward",
        "缓慢向下平移"
    ]
] as const;
    for (const [type, english, chinese, description, translatedDescription] of presets) {
      fireEvent.click(screen.getByRole("button", { name: ui(english, chinese) }));
      await waitFor(() => expect(animation()?.type).toBe(type));
      expect(screen.getByText(ui(description, translatedDescription))).toBeInTheDocument();
    }
  });
  it("saves focus presets and resets localized timing controls", async () => {
    render(<EmphasisAnimationSection clipId="clip-1" />);
    fireEvent.click(screen.getByRole("button", { name: ui("Focus Zoom", "焦点缩放") }));
    await waitFor(() => expect(animation()).toMatchObject({ type: "focus-zoom", focusPoint: { x: 0.5, y: 0.5 }, loop: false }));
    expect(screen.getByText(ui("Focus Zoom Settings", "焦点缩放设置"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Focus: Bottom right", "焦点：右下") }));
    await waitFor(() => expect(animation()?.focusPoint).toEqual({ x: 1, y: 1 }));
    fireEvent.keyDown(screen.getByRole("slider", { name: ui("Start Time", "开始时间") }), { key: "ArrowRight" });
    await waitFor(() => expect(animation()?.startTime).toBeCloseTo(0.1));
    fireEvent.click(screen.getByRole("button", { name: ui("Reset to full clip", "重置为整个片段") }));
    await waitFor(() => expect(animation()?.startTime).toBe(0));
    expect(animation()?.animationDuration).toBeUndefined();
    expect(screen.getByText(ui("Full clip", "整个片段"))).toBeInTheDocument();
  });
});
