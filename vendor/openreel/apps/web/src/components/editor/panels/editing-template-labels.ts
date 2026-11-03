import { getBuiltInEditingTemplate, type EditingTemplate, type EditingTemplateControlDefinition } from "@openreel/core";
import { editorMessage } from "../../../shotloom-mode";

// Only unchanged fields of known built-ins use catalog translations.
const templateKeys = {
  "cinema-letterbox": { name: "editor.recipeCatalog.cinema-letterbox.name", description: "editor.recipeCatalog.cinema-letterbox.description" },
  "cinema-light-frame": { name: "editor.recipeCatalog.cinema-light-frame.name", description: "editor.recipeCatalog.cinema-light-frame.description" },
  "cinema-warm-fade": { name: "editor.recipeCatalog.cinema-warm-fade.name", description: "editor.recipeCatalog.cinema-warm-fade.description" },
  "glitch-digital": { name: "editor.recipeCatalog.glitch-digital.name", description: "editor.recipeCatalog.glitch-digital.description" },
  "glitch-rgb-scan": { name: "editor.recipeCatalog.glitch-rgb-scan.name", description: "editor.recipeCatalog.glitch-rgb-scan.description" },
  "glitch-static-frame": { name: "editor.recipeCatalog.glitch-static-frame.name", description: "editor.recipeCatalog.glitch-static-frame.description" },
  "retro-vhs": { name: "editor.recipeCatalog.retro-vhs.name", description: "editor.recipeCatalog.retro-vhs.description" },
  "retro-crt-monitor": { name: "editor.recipeCatalog.retro-crt-monitor.name", description: "editor.recipeCatalog.retro-crt-monitor.description" },
  "retro-old-film": { name: "editor.recipeCatalog.retro-old-film.name", description: "editor.recipeCatalog.retro-old-film.description" },
  "retro-sepia-drift": { name: "editor.recipeCatalog.retro-sepia-drift.name", description: "editor.recipeCatalog.retro-sepia-drift.description" },
  "social-recording": { name: "editor.recipeCatalog.social-recording.name", description: "editor.recipeCatalog.social-recording.description" },
  "social-facecam-frame": { name: "editor.recipeCatalog.social-facecam-frame.name", description: "editor.recipeCatalog.social-facecam-frame.description" },
  "social-countdown-lead": { name: "editor.recipeCatalog.social-countdown-lead.name", description: "editor.recipeCatalog.social-countdown-lead.description" },
  "social-comment-pop": { name: "editor.recipeCatalog.social-comment-pop.name", description: "editor.recipeCatalog.social-comment-pop.description" },
  "branding-watermark-drift": { name: "editor.recipeCatalog.branding-watermark-drift.name", description: "editor.recipeCatalog.branding-watermark-drift.description" },
  "branding-copyright": { name: "editor.recipeCatalog.branding-copyright.name", description: "editor.recipeCatalog.branding-copyright.description" },
  "branding-lower-third": { name: "editor.recipeCatalog.branding-lower-third.name", description: "editor.recipeCatalog.branding-lower-third.description" },
  "branding-subscribe-tag": { name: "editor.recipeCatalog.branding-subscribe-tag.name", description: "editor.recipeCatalog.branding-subscribe-tag.description" },
  "color-warm-pop": { name: "editor.recipeCatalog.color-warm-pop.name", description: "editor.recipeCatalog.color-warm-pop.description" },
  "color-cool-bloom": { name: "editor.recipeCatalog.color-cool-bloom.name", description: "editor.recipeCatalog.color-cool-bloom.description" },
  "color-dramatic-noir": { name: "editor.recipeCatalog.color-dramatic-noir.name", description: "editor.recipeCatalog.color-dramatic-noir.description" },
  "color-vintage-wash": { name: "editor.recipeCatalog.color-vintage-wash.name", description: "editor.recipeCatalog.color-vintage-wash.description" },
  "overlay-focus-frame": { name: "editor.recipeCatalog.overlay-focus-frame.name", description: "editor.recipeCatalog.overlay-focus-frame.description" },
  "overlay-soft-border": { name: "editor.recipeCatalog.overlay-soft-border.name", description: "editor.recipeCatalog.overlay-soft-border.description" },
  "overlay-spotlight-title": { name: "editor.recipeCatalog.overlay-spotlight-title.name", description: "editor.recipeCatalog.overlay-spotlight-title.description" },
  "text-kinetic-punch": { name: "editor.recipeCatalog.text-kinetic-punch.name", description: "editor.recipeCatalog.text-kinetic-punch.description" },
  "text-stamp-upper": { name: "editor.recipeCatalog.text-stamp-upper.name", description: "editor.recipeCatalog.text-stamp-upper.description" },
  "text-neon-tag": { name: "editor.recipeCatalog.text-neon-tag.name", description: "editor.recipeCatalog.text-neon-tag.description" },
  "social-live-badge": { name: "editor.recipeCatalog.social-live-badge.name", description: "editor.recipeCatalog.social-live-badge.description" },
  "social-hashtag-strip": { name: "editor.recipeCatalog.social-hashtag-strip.name", description: "editor.recipeCatalog.social-hashtag-strip.description" },
  "cinema-anamorphic-flare": { name: "editor.recipeCatalog.cinema-anamorphic-flare.name", description: "editor.recipeCatalog.cinema-anamorphic-flare.description" },
  "cinema-noir-bars": { name: "editor.recipeCatalog.cinema-noir-bars.name", description: "editor.recipeCatalog.cinema-noir-bars.description" },
  "overlay-grid-guide": { name: "editor.recipeCatalog.overlay-grid-guide.name", description: "editor.recipeCatalog.overlay-grid-guide.description" },
  "overlay-corner-brackets": { name: "editor.recipeCatalog.overlay-corner-brackets.name", description: "editor.recipeCatalog.overlay-corner-brackets.description" },
  "text-subtitle-bar": { name: "editor.recipeCatalog.text-subtitle-bar.name", description: "editor.recipeCatalog.text-subtitle-bar.description" },
  "text-quote-block": { name: "editor.recipeCatalog.text-quote-block.name", description: "editor.recipeCatalog.text-quote-block.description" },
  "color-teal-orange": { name: "editor.recipeCatalog.color-teal-orange.name", description: "editor.recipeCatalog.color-teal-orange.description" },
  "color-monochrome": { name: "editor.recipeCatalog.color-monochrome.name", description: "editor.recipeCatalog.color-monochrome.description" },
  "glitch-datamosh": { name: "editor.recipeCatalog.glitch-datamosh.name", description: "editor.recipeCatalog.glitch-datamosh.description" },
  "branding-end-card": { name: "editor.recipeCatalog.branding-end-card.name", description: "editor.recipeCatalog.branding-end-card.description" },
  "social-viewer-count": { name: "editor.recipeCatalog.social-viewer-count.name", description: "editor.recipeCatalog.social-viewer-count.description" },
  "retro-polaroid": { name: "editor.recipeCatalog.retro-polaroid.name", description: "editor.recipeCatalog.retro-polaroid.description" },
  "motion-saas-ad-card": { name: "editor.recipeCatalog.motion-saas-ad-card.name", description: "editor.recipeCatalog.motion-saas-ad-card.description" },
} as const;

const controlKeys = {
  "grainAmount": "editor.recipeControls.grainAmount",
  "barOpacity": "editor.recipeControls.barOpacity",
  "frameOpacity": "editor.recipeControls.frameOpacity",
  "warmth": "editor.recipeControls.warmth",
  "glitchAmount": "editor.recipeControls.glitchAmount",
  "watermarkText": "editor.recipeControls.watermarkText",
  "watermarkOpacity": "editor.recipeControls.watermarkOpacity",
  "name": "editor.recipeControls.name",
  "role": "editor.recipeControls.role",
  "accent": "editor.recipeControls.accent",
  "headline": "editor.recipeControls.headline",
  "caption": "editor.recipeControls.caption",
  "label": "editor.recipeControls.label",
  "tag": "editor.recipeControls.tag",
  "tags": "editor.recipeControls.tags",
  "gridOpacity": "editor.recipeControls.gridOpacity",
  "subtitle": "editor.recipeControls.subtitle",
  "quote": "editor.recipeControls.quote",
  "channel": "editor.recipeControls.channel",
  "cta": "editor.recipeControls.cta",
  "count": "editor.recipeControls.count",
  "brandColor": "editor.recipeControls.brandColor",
  "duration": "editor.recipeControls.duration",
  "intensity": "editor.recipeControls.intensity",
  "media": "editor.recipeControls.media",
  "brandKit": "editor.recipeControls.brandKit"
} as const;

export function editingTemplateText(template: EditingTemplate, field: "name" | "description"): string {
  const original = getBuiltInEditingTemplate(template.id);
  return original && original[field] === template[field] && Object.hasOwn(templateKeys, template.id)
    ? editorMessage(templateKeys[template.id as keyof typeof templateKeys][field])
    : template[field];
}

export function editingTemplateControlLabel(template: EditingTemplate, control: EditingTemplateControlDefinition): string {
  const original = getBuiltInEditingTemplate(template.id)?.controls?.find((candidate) => candidate.id === control.id);
  return original && original.label === control.label && Object.hasOwn(controlKeys, control.id)
    ? editorMessage(controlKeys[control.id as keyof typeof controlKeys])
    : control.label;
}
