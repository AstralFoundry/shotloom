import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../../shotloom-mode";
import { ScreenRecorderService, screenRecorderService, DEFAULT_RECORDING_OPTIONS } from "../../services/screen-recorder";
import { useRecorderStore } from "../../stores/recorder-store";
import { ScreenRecorder } from "./ScreenRecorder";
import { RecordingCountdown } from "./RecordingCountdown";
import { RecordingControls } from "./RecordingControls";

beforeEach(() => {
  useRecorderStore.setState({ status: "idle", error: null, screenStream: null, isControlsMinimized: false, options: structuredClone(DEFAULT_RECORDING_OPTIONS) });
  vi.spyOn(ScreenRecorderService, "isSupported").mockReturnValue(true);
  vi.spyOn(ScreenRecorderService, "getSupportedFeatures").mockReturnValue({ screenCapture: true, systemAudio: true, webcam: true, vp9: true, h264: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  configureShotloomLocale("en-US");
});

describe("screen recording languages", () => {
  it.each([
    ["en-US", "Screen Recording", "Microphone", "Start Recording", "Recording Error"],
    ["zh-CN", "屏幕录制", "麦克风", "开始录制", "录制出错"],
  ])("submits raw settings and preserves upstream failures in %s", async (locale, title, mic, start, errorTitle) => {
    configureShotloomLocale(locale);
    const upstream = new Error("Device failure {name} $&");
    const request = vi.spyOn(screenRecorderService, "requestPermissions").mockRejectedValue(upstream);
    const complete = vi.fn();
    render(<ScreenRecorder isOpen onClose={vi.fn()} onRecordingComplete={complete} />);
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText(locale === "zh-CN" ? "1920×1080 · 推荐" : "1920×1080 - Recommended")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: mic }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: start })); });
    expect(request).toHaveBeenCalledWith({ video: { resolution: "1080p", frameRate: 30 }, audio: { systemAudio: true, microphone: true }, webcam: { enabled: false, resolution: "720p" } });
    expect(screen.getByText(errorTitle)).toBeInTheDocument();
    expect(screen.getByText(upstream.message)).toBeInTheDocument();
    expect(complete).not.toHaveBeenCalled();
  });

  it.each([["en-US", "Recording..."], ["zh-CN", "正在录制…"]])("keeps the countdown and controls working in %s", (locale, recording) => {
    configureShotloomLocale(locale);
    vi.useFakeTimers();
    const view = render(<RecordingCountdown />);
    for (let tick = 0; tick < 3; tick++) act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText(recording)).toBeInTheDocument();
    view.unmount();
    useRecorderStore.setState({ status: "recording", duration: 12345 });
    const onPause = vi.fn(), onStop = vi.fn(), onResume = vi.fn();
    render(<RecordingControls onPause={onPause} onStop={onStop} onResume={onResume} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: locale === "zh-CN" ? "暂停录制" : "Pause recording" }));
    expect(onPause).toHaveBeenCalledOnce();
    act(() => useRecorderStore.setState({ status: "paused" }));
    fireEvent.click(screen.getByRole("button", { name: locale === "zh-CN" ? "继续录制" : "Resume recording" }));
    expect(onResume).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: locale === "zh-CN" ? "停止录制" : "Stop recording" }));
    expect(onStop).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: locale === "zh-CN" ? "收起控制栏" : "Minimize controls" }));
    fireEvent.click(screen.getByRole("button", { name: locale === "zh-CN" ? "展开录制控制栏（0:12）" : "Expand recording controls (0:12)" }));
    expect(useRecorderStore.getState().isControlsMinimized).toBe(false);
  });

  it("explains unsupported recording in Chinese and prevents a permission request", () => {
    configureShotloomLocale("zh-CN");
    vi.mocked(ScreenRecorderService.isSupported).mockReturnValue(false);
    const request = vi.spyOn(screenRecorderService, "requestPermissions");
    render(<ScreenRecorder isOpen onClose={vi.fn()} onRecordingComplete={vi.fn()} />);
    expect(screen.getByText("当前浏览器不支持屏幕录制，请使用 Chrome、Edge 或 Firefox。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始录制" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "开始录制" }));
    expect(request).not.toHaveBeenCalled();
  });

  it("uses a Chinese own error when no stream exists", async () => {
    configureShotloomLocale("zh-CN");
    await useRecorderStore.getState().startRecording();
    expect(useRecorderStore.getState()).toMatchObject({ status: "error", error: "没有可用的屏幕流" });
    await expect(screenRecorderService.startRecording(DEFAULT_RECORDING_OPTIONS)).rejects.toThrow("屏幕流尚未初始化，请先授权屏幕录制。");
  });
});
