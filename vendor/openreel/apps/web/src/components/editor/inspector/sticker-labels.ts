import { editorMessage } from "../../../shotloom-mode";
import type { EmojiItem } from "@openreel/core";

const emojiLabels = {
  "grinning": "editor.stickerPicker.emoji.grinning",
  "joy": "editor.stickerPicker.emoji.joy",
  "heart_eyes": "editor.stickerPicker.emoji.heart_eyes",
  "thinking": "editor.stickerPicker.emoji.thinking",
  "sunglasses": "editor.stickerPicker.emoji.sunglasses",
  "wink": "editor.stickerPicker.emoji.wink",
  "thumbsup": "editor.stickerPicker.emoji.thumbsup",
  "clap": "editor.stickerPicker.emoji.clap",
  "fire": "editor.stickerPicker.emoji.fire",
  "heart": "editor.stickerPicker.emoji.heart",
  "star": "editor.stickerPicker.emoji.star",
  "sparkles": "editor.stickerPicker.emoji.sparkles",
  "wave": "editor.stickerPicker.emoji.wave",
  "ok_hand": "editor.stickerPicker.emoji.ok_hand",
  "point_up": "editor.stickerPicker.emoji.point_up",
  "point_right": "editor.stickerPicker.emoji.point_right",
  "raised_hands": "editor.stickerPicker.emoji.raised_hands",
  "pray": "editor.stickerPicker.emoji.pray",
  "muscle": "editor.stickerPicker.emoji.muscle",
  "v": "editor.stickerPicker.emoji.v",
  "camera": "editor.stickerPicker.emoji.camera",
  "video_camera": "editor.stickerPicker.emoji.video_camera",
  "microphone": "editor.stickerPicker.emoji.microphone",
  "headphones": "editor.stickerPicker.emoji.headphones",
  "movie_camera": "editor.stickerPicker.emoji.movie_camera",
  "clapper": "editor.stickerPicker.emoji.clapper",
  "trophy": "editor.stickerPicker.emoji.trophy",
  "medal": "editor.stickerPicker.emoji.medal",
  "bell": "editor.stickerPicker.emoji.bell",
  "megaphone": "editor.stickerPicker.emoji.megaphone",
  "check": "editor.stickerPicker.emoji.check",
  "x": "editor.stickerPicker.emoji.x",
  "question": "editor.stickerPicker.emoji.question",
  "exclamation": "editor.stickerPicker.emoji.exclamation",
  "100": "editor.stickerPicker.emoji.100",
  "arrow_right": "editor.stickerPicker.emoji.arrow_right",
  "arrow_left": "editor.stickerPicker.emoji.arrow_left",
  "arrow_up": "editor.stickerPicker.emoji.arrow_up",
  "arrow_down": "editor.stickerPicker.emoji.arrow_down",
  "new": "editor.stickerPicker.emoji.new",
  "free": "editor.stickerPicker.emoji.free",
  "sun": "editor.stickerPicker.emoji.sun",
  "moon": "editor.stickerPicker.emoji.moon",
  "cloud": "editor.stickerPicker.emoji.cloud",
  "rainbow": "editor.stickerPicker.emoji.rainbow",
  "snowflake": "editor.stickerPicker.emoji.snowflake",
  "lightning": "editor.stickerPicker.emoji.lightning",
  "flower": "editor.stickerPicker.emoji.flower",
  "tree": "editor.stickerPicker.emoji.tree",
} as const;
const categoryLabels = {
  "smileys": "editor.stickerPicker.category.smileys",
  "gestures": "editor.stickerPicker.category.gestures",
  "objects": "editor.stickerPicker.category.objects",
  "symbols": "editor.stickerPicker.category.symbols",
  "nature": "editor.stickerPicker.category.nature",
  "arrows": "editor.stickerPicker.category.arrows",
  "badges": "editor.stickerPicker.category.badges",
  "banners": "editor.stickerPicker.category.banners",
  "callouts": "editor.stickerPicker.category.callouts",
  "social": "editor.stickerPicker.category.social",
  "custom": "editor.stickerPicker.category.custom",
} as const;

export function emojiLabel(emoji: EmojiItem): string {
  return Object.hasOwn(emojiLabels, emoji.id)
    ? editorMessage(emojiLabels[emoji.id as keyof typeof emojiLabels]) : emoji.name;
}

export function stickerCategoryLabel(category: { id: string; name: string }): string {
  return Object.hasOwn(categoryLabels, category.id)
    ? editorMessage(categoryLabels[category.id as keyof typeof categoryLabels]) : category.name;
}

export function searchLocalizedEmojis(emojis: readonly EmojiItem[], query: string): EmojiItem[] {
  const search = query.toLocaleLowerCase();
  return emojis.filter(emoji => emoji.name.toLocaleLowerCase().includes(search)
    || emojiLabel(emoji).toLocaleLowerCase().includes(search) || emoji.emoji.includes(query));
}
