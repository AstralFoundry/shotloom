import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { useProjectStore } from "../../../stores/project-store";
import { useKieAIStore } from "../../../stores/kieai-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { IMAGE_MODELS } from "../../../services/kieai/image-generation";
import { ModelPicker } from "./ModelPicker";
import { KieAIImageDialog } from "./KieAIImageDialog";
const api = vi.hoisted(() => ({ upload: vi.fn(), create: vi.fn(), placeholder: vi.fn(), task: vi.fn() }));
vi.mock("../../../services/kieai/file-upload", () => ({ uploadFileStream: api.upload }));
vi.mock("../../../services/kieai/image-generation", async importOriginal => ({ ...await importOriginal<typeof import("../../../services/kieai/image-generation")>(), createImageTask: api.create }));
const originalPlaceholder = useProjectStore.getState().addPlaceholderMedia;
const originalTask = useKieAIStore.getState().addTask;
const source = new File(["image"], "User {name}.png", { type: "image/png" });
const models = [
  ["Seedream 5 Lite", "Seedream", IMAGE_MODELS.SEEDREAM, "image_urls"],
  ["Z-Image", "Z-Image", IMAGE_MODELS.Z_IMAGE, ""],
  ["Nano Banana 2", "Nano Banana 2", IMAGE_MODELS.NANO_BANANA2, "image_input"],
  ["Flux 2 Pro", "Flux 2", IMAGE_MODELS.FLUX2, "input_urls"],
  ["Grok Imagine", "Grok Imagine", IMAGE_MODELS.GROK, "image_urls"],
  ["Qwen", "Qwen", IMAGE_MODELS.QWEN, "image_url"],
] as const;
describe.each(["en-US", "zh-CN"] as const)("Image generation dialog (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale); vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    api.upload.mockResolvedValue({ fileUrl: "https://example.test/source.png" });
    api.create.mockResolvedValue("task-original");
    useProjectStore.setState({ project: createEmptyProject("Original project"), hasOpenProject: true, addPlaceholderMedia: api.placeholder });
    useKieAIStore.setState({ addTask: api.task });
  });
  afterEach(() => {
    cleanup(); vi.restoreAllMocks(); configureShotloomLocale("en-US");
    useProjectStore.setState({ hasOpenProject: false, addPlaceholderMedia: originalPlaceholder });
    useKieAIStore.setState({ addTask: originalTask });
  });
  it("shows translated descriptions and badges while selecting original model IDs", () => {
    const select = vi.fn(); render(<ModelPicker onSelect={select} />);
    expect(screen.getByText(ui("Select a model to generate a new image from your source.", "选择模型，根据源图片生成新图片。"))).toBeInTheDocument();
    for (const [name, , id] of models) { fireEvent.click(screen.getByRole("button", { name })); expect(select).toHaveBeenLastCalledWith(id); }
    expect(screen.getByText(ui("Versatile", "多用途"))).toBeInTheDocument();
    expect(screen.getByText(ui("Text-to-image generation. Source image is used as inspiration only.", "文生图，源图片仅作为灵感。"))).toBeInTheDocument();
  });
  it.each(models)("submits %s using the original model, prompt and reference field", async (name, generator, id, field) => {
    const close = vi.fn(); render(<KieAIImageDialog open onClose={close} sourceFile={source} previewUrl="data:image/png;base64,AA==" />);
    expect(screen.getByText(ui("Create with KieAI", "使用 KieAI 创作"))).toBeInTheDocument();
    expect(screen.getByAltText(ui("Source image", "源图片"))).toHaveAttribute("src", "data:image/png;base64,AA==");
    expect(screen.getByText(source.name)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name }));
    fireEvent.click(screen.getByRole("button", { name: ui("Back to model selection", "返回模型选择") }));
    fireEvent.click(screen.getByRole("button", { name }));
    fireEvent.change(screen.getByRole("textbox", { name: generator === "Grok Imagine" ? ui("Prompt (optional)", "提示词（可选）") : ui("Prompt", "提示词") }), { target: { value: "User {model} $& prompt" } });
    fireEvent.click(screen.getByRole("button", { name: ui(`Generate with ${generator}`, `使用 ${generator} 生成`) }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    const expected: Record<string, unknown> = { prompt: "User {model} $& prompt" };
    if (field) expected[field] = field === "image_url" ? "https://example.test/source.png" : ["https://example.test/source.png"];
    expect(api.create).toHaveBeenCalledWith(id, expect.objectContaining(expected));
    expect(api.upload).toHaveBeenCalledTimes(field ? 1 : 0);
    expect(api.placeholder).toHaveBeenCalledWith(expect.objectContaining({ name: "User {name}_kieai.png", kieaiTaskId: "task-original", isPlaceholder: true, isPending: true }));
    expect(api.task).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task-original", projectId: useProjectStore.getState().project.id, type: "image" }));
  });
  it("shows localized upload failure, preserves external details and returns to the form", async () => {
    api.upload.mockResolvedValueOnce({});
    const close = vi.fn(); render(<KieAIImageDialog open onClose={close} sourceFile={source} previewUrl={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Grok Imagine" }));
    const submit = () => fireEvent.click(screen.getByRole("button", { name: ui("Generate with Grok Imagine", "使用 Grok Imagine 生成") }));
    submit();
    expect(await screen.findByText(ui("Submission Failed", "提交失败"))).toBeInTheDocument();
    expect(screen.getByText(ui("Upload succeeded but returned no file URL. Check console for response.", "上传成功但未返回文件地址，请查看控制台响应。"))).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: ui("Try Again", "重试") }));
    api.create.mockRejectedValueOnce(new Error("Provider {error} $& detail")); submit();
    expect(await screen.findByText("Provider {error} $& detail")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Close", "关闭") }));
    expect(close).toHaveBeenCalledOnce(); expect(api.task).not.toHaveBeenCalled();
  });
  it("cancels a pending upload and avoids creating or registering a task", async () => {
    let finish!: (value: { fileUrl: string }) => void;
    api.upload.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const close = vi.fn(); render(<KieAIImageDialog open onClose={close} sourceFile={source} previewUrl={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Grok Imagine" }));
    fireEvent.click(screen.getByRole("button", { name: ui("Generate with Grok Imagine", "使用 Grok Imagine 生成") }));
    expect(await screen.findByText(ui("Uploading and submitting task...", "正在上传并提交任务…"))).toBeInTheDocument();
    expect(screen.getByText(ui("Submitting...", "正在提交…"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Cancel", "取消") }));
    await act(async () => finish({ fileUrl: "https://example.test/source.png" }));
    expect(close).toHaveBeenCalledOnce(); expect(api.create).not.toHaveBeenCalled(); expect(api.task).not.toHaveBeenCalled(); expect(api.placeholder).not.toHaveBeenCalled();
  });
});
