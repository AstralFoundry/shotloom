import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMOJI_CATEGORIES } from "@openreel/core";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { StickerPicker } from "./StickerPicker";
const bridge = vi.hoisted(() => ({
  isInitialized: () => true, initialize: vi.fn(), getEmojiCategories: vi.fn(), getStickerCategories: vi.fn(),
  getEmojisByCategory: vi.fn(), getStickersByCategory: vi.fn(), searchStickers: vi.fn(),
  addEmoji: vi.fn(() => ({ id: "created-emoji" })), addSticker: vi.fn(() => ({ id: "created-sticker" })),
}));
vi.mock("../../../bridges", () => ({ getGraphicsBridge: () => bridge }));
describe.each(["en-US", "zh-CN"] as const)("embedded sticker picker (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale); vi.clearAllMocks();
    bridge.getEmojiCategories.mockReturnValue(EMOJI_CATEGORIES);
    bridge.getStickerCategories.mockReturnValue([{ id: "arrows", name: "Arrows", icon: "➡️" }]);
    bridge.getEmojisByCategory.mockImplementation(id => EMOJI_CATEGORIES.find(c => c.id === id)?.emojis ?? []);
    bridge.getStickersByCategory.mockReturnValue([{ id: "user-sticker", name: "原始 {name}", imageUrl: "data:image/png;base64,", category: "arrows" }]);
    bridge.searchStickers.mockReturnValue([]);
  });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  it("searches localized names, clears the query and sends the original emoji parameters", () => {
    const onSelect = vi.fn(); render(<StickerPicker trackId="original-track" startTime={4.25} duration={7} onSelect={onSelect} />);
    const search = screen.getByRole("textbox", { name: ui("Search emojis", "搜索表情") });
    fireEvent.change(search, { target: { value: ui("Thinking", "思考") } });
    fireEvent.click(screen.getByRole("button", { name: ui("Thinking Face", "思考") }));
    expect(bridge.addEmoji).toHaveBeenCalledWith({ trackId: "original-track", startTime: 4.25, duration: 7, emoji: "🤔" });
    expect(onSelect).toHaveBeenCalledWith("created-emoji");
    fireEvent.change(search, { target: { value: "{missing}" } });
    expect(screen.getByText(ui('No emojis found for "{missing}"', '未找到与“{missing}”匹配的表情'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Clear search", "清除搜索") }));
    expect(screen.getByRole("button", { name: ui("Smileys & Emotion", "笑脸与情绪") })).toBeInTheDocument();
  });
  it("translates sticker categories and preserves user sticker names and IDs", () => {
    const onSelect = vi.fn(); render(<StickerPicker trackId="original-track" startTime={4.25} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: ui("Stickers", "贴纸") }));
    expect(screen.getByRole("button", { name: ui("➡️ Arrows", "➡️ 箭头") })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "原始 {name}" }));
    expect(bridge.addSticker).toHaveBeenCalledWith({ trackId: "original-track", startTime: 4.25, duration: 5, stickerId: "user-sticker" });
    expect(onSelect).toHaveBeenCalledWith("created-sticker");
  });
});
