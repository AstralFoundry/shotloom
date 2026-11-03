import { getMotionPreset, type MotionComposition } from "@openreel/core";
import { editorMessage } from "../shotloom-mode";

const presetDefaults: Record<string, Record<string, Parameters<typeof editorMessage>[0]>> = {
  "motion-ad-card": {
    "name": "editor.motion.templates.motion-ad-card",
    "variable.headline.name": "editor.motion.templates.defaults.motion-ad-card.variable.headline.name",
    "variable.headline.value": "editor.motion.templates.defaults.motion-ad-card.variable.headline.value",
    "variable.subheadline.name": "editor.motion.templates.defaults.motion-ad-card.variable.subheadline.name",
    "variable.subheadline.value": "editor.motion.templates.defaults.motion-ad-card.variable.subheadline.value",
    "variable.brand-color.name": "editor.motion.templates.defaults.motion-ad-card.variable.brand-color.name",
    "layer.ad-bg-wash.name": "editor.motion.templates.defaults.motion-ad-card.layer.ad-bg-wash.name",
    "layer.ad-accent-bar.name": "editor.motion.templates.defaults.motion-ad-card.layer.ad-accent-bar.name",
    "layer.ad-headline.name": "editor.motion.templates.defaults.motion-ad-card.layer.ad-headline.name",
    "layer.ad-headline.text": "editor.motion.templates.defaults.motion-ad-card.layer.ad-headline.text",
    "layer.ad-subheadline.name": "editor.motion.templates.defaults.motion-ad-card.layer.ad-subheadline.name",
    "layer.ad-subheadline.text": "editor.motion.templates.defaults.motion-ad-card.layer.ad-subheadline.text"
  },
  "motion-app-ui-demo": {
    "name": "editor.motion.templates.motion-app-ui-demo",
    "variable.headline.name": "editor.motion.templates.defaults.motion-app-ui-demo.variable.headline.name",
    "variable.headline.value": "editor.motion.templates.defaults.motion-app-ui-demo.variable.headline.value",
    "variable.brand-color.name": "editor.motion.templates.defaults.motion-app-ui-demo.variable.brand-color.name",
    "layer.ui-window.name": "editor.motion.templates.defaults.motion-app-ui-demo.layer.ui-window.name",
    "layer.ui-sidebar.name": "editor.motion.templates.defaults.motion-app-ui-demo.layer.ui-sidebar.name",
    "layer.ui-primary-card.name": "editor.motion.templates.defaults.motion-app-ui-demo.layer.ui-primary-card.name",
    "layer.ui-cursor.name": "editor.motion.templates.defaults.motion-app-ui-demo.layer.ui-cursor.name",
    "layer.ui-headline.name": "editor.motion.templates.defaults.motion-app-ui-demo.layer.ui-headline.name",
    "layer.ui-headline.text": "editor.motion.templates.defaults.motion-app-ui-demo.layer.ui-headline.text"
  },
  "motion-lower-third": {
    "name": "editor.motion.templates.motion-lower-third",
    "variable.name.name": "editor.motion.templates.defaults.motion-lower-third.variable.name.name",
    "variable.name.value": "editor.motion.templates.defaults.motion-lower-third.variable.name.value",
    "variable.title.name": "editor.motion.templates.defaults.motion-lower-third.variable.title.name",
    "variable.title.value": "editor.motion.templates.defaults.motion-lower-third.variable.title.value",
    "variable.brand-color.name": "editor.motion.templates.defaults.motion-lower-third.variable.brand-color.name",
    "layer.lt-panel.name": "editor.motion.templates.defaults.motion-lower-third.layer.lt-panel.name",
    "layer.lt-accent.name": "editor.motion.templates.defaults.motion-lower-third.layer.lt-accent.name",
    "layer.lt-name.name": "editor.motion.templates.defaults.motion-lower-third.layer.lt-name.name",
    "layer.lt-name.text": "editor.motion.templates.defaults.motion-lower-third.layer.lt-name.text",
    "layer.lt-title.name": "editor.motion.templates.defaults.motion-lower-third.layer.lt-title.name",
    "layer.lt-title.text": "editor.motion.templates.defaults.motion-lower-third.layer.lt-title.text"
  },
  "motion-product-shot": {
    "name": "editor.motion.templates.motion-product-shot",
    "variable.headline.name": "editor.motion.templates.defaults.motion-product-shot.variable.headline.name",
    "variable.headline.value": "editor.motion.templates.defaults.motion-product-shot.variable.headline.value",
    "variable.badge.name": "editor.motion.templates.defaults.motion-product-shot.variable.badge.name",
    "variable.badge.value": "editor.motion.templates.defaults.motion-product-shot.variable.badge.value",
    "variable.brand-color.name": "editor.motion.templates.defaults.motion-product-shot.variable.brand-color.name",
    "layer.product-card.name": "editor.motion.templates.defaults.motion-product-shot.layer.product-card.name",
    "layer.product-screen.name": "editor.motion.templates.defaults.motion-product-shot.layer.product-screen.name",
    "layer.product-badge-pill.name": "editor.motion.templates.defaults.motion-product-shot.layer.product-badge-pill.name",
    "layer.product-badge.name": "editor.motion.templates.defaults.motion-product-shot.layer.product-badge.name",
    "layer.product-badge.text": "editor.motion.templates.defaults.motion-product-shot.layer.product-badge.text",
    "layer.product-headline.name": "editor.motion.templates.defaults.motion-product-shot.layer.product-headline.name",
    "layer.product-headline.text": "editor.motion.templates.defaults.motion-product-shot.layer.product-headline.text"
  },
  "motion-social-hook": {
    "name": "editor.motion.templates.motion-social-hook",
    "variable.hook.name": "editor.motion.templates.defaults.motion-social-hook.variable.hook.name",
    "variable.hook.value": "editor.motion.templates.defaults.motion-social-hook.variable.hook.value",
    "variable.subhook.name": "editor.motion.templates.defaults.motion-social-hook.variable.subhook.name",
    "variable.subhook.value": "editor.motion.templates.defaults.motion-social-hook.variable.subhook.value",
    "variable.brand-color.name": "editor.motion.templates.defaults.motion-social-hook.variable.brand-color.name",
    "layer.social-swipe.name": "editor.motion.templates.defaults.motion-social-hook.layer.social-swipe.name",
    "layer.social-hook.name": "editor.motion.templates.defaults.motion-social-hook.layer.social-hook.name",
    "layer.social-hook.text": "editor.motion.templates.defaults.motion-social-hook.layer.social-hook.text",
    "layer.social-subhook.name": "editor.motion.templates.defaults.motion-social-hook.layer.social-subhook.name",
    "layer.social-subhook.text": "editor.motion.templates.defaults.motion-social-hook.layer.social-subhook.text",
    "layer.social-progress.name": "editor.motion.templates.defaults.motion-social-hook.layer.social-progress.name"
  },
  "motion-kinetic-title": {
    "name": "editor.motion.templates.motion-kinetic-title",
    "variable.word-1.name": "editor.motion.templates.defaults.motion-kinetic-title.variable.word-1.name",
    "variable.word-1.value": "editor.motion.templates.defaults.motion-kinetic-title.variable.word-1.value",
    "variable.word-2.name": "editor.motion.templates.defaults.motion-kinetic-title.variable.word-2.name",
    "variable.word-2.value": "editor.motion.templates.defaults.motion-kinetic-title.variable.word-2.value",
    "variable.word-3.name": "editor.motion.templates.defaults.motion-kinetic-title.variable.word-3.name",
    "variable.word-3.value": "editor.motion.templates.defaults.motion-kinetic-title.variable.word-3.value",
    "variable.brand-color.name": "editor.motion.templates.defaults.motion-kinetic-title.variable.brand-color.name",
    "layer.kinetic-word-1.name": "editor.motion.templates.defaults.motion-kinetic-title.layer.kinetic-word-1.name",
    "layer.kinetic-word-1.text": "editor.motion.templates.defaults.motion-kinetic-title.layer.kinetic-word-1.text",
    "layer.kinetic-word-2.name": "editor.motion.templates.defaults.motion-kinetic-title.layer.kinetic-word-2.name",
    "layer.kinetic-word-2.text": "editor.motion.templates.defaults.motion-kinetic-title.layer.kinetic-word-2.text",
    "layer.kinetic-word-3.name": "editor.motion.templates.defaults.motion-kinetic-title.layer.kinetic-word-3.name",
    "layer.kinetic-word-3.text": "editor.motion.templates.defaults.motion-kinetic-title.layer.kinetic-word-3.text"
  },
  "motion-logo-reveal": {
    "name": "editor.motion.templates.motion-logo-reveal",
    "variable.brand-name.name": "editor.motion.templates.defaults.motion-logo-reveal.variable.brand-name.name",
    "variable.brand-name.value": "editor.motion.templates.defaults.motion-logo-reveal.variable.brand-name.value",
    "variable.brand-color.name": "editor.motion.templates.defaults.motion-logo-reveal.variable.brand-color.name",
    "layer.logo-ring.name": "editor.motion.templates.defaults.motion-logo-reveal.layer.logo-ring.name",
    "layer.logo-mark.name": "editor.motion.templates.defaults.motion-logo-reveal.layer.logo-mark.name",
    "layer.logo-name.name": "editor.motion.templates.defaults.motion-logo-reveal.layer.logo-name.name",
    "layer.logo-name.text": "editor.motion.templates.defaults.motion-logo-reveal.layer.logo-name.text"
  },
  "motion-end-screen": {
    "name": "editor.motion.templates.motion-end-screen",
    "variable.headline.name": "editor.motion.templates.defaults.motion-end-screen.variable.headline.name",
    "variable.headline.value": "editor.motion.templates.defaults.motion-end-screen.variable.headline.value",
    "variable.cta.name": "editor.motion.templates.defaults.motion-end-screen.variable.cta.name",
    "variable.cta.value": "editor.motion.templates.defaults.motion-end-screen.variable.cta.value",
    "variable.brand-color.name": "editor.motion.templates.defaults.motion-end-screen.variable.brand-color.name",
    "layer.end-headline.name": "editor.motion.templates.defaults.motion-end-screen.layer.end-headline.name",
    "layer.end-headline.text": "editor.motion.templates.defaults.motion-end-screen.layer.end-headline.text",
    "layer.end-card-left.name": "editor.motion.templates.defaults.motion-end-screen.layer.end-card-left.name",
    "layer.end-card-right.name": "editor.motion.templates.defaults.motion-end-screen.layer.end-card-right.name",
    "layer.end-cta-pill.name": "editor.motion.templates.defaults.motion-end-screen.layer.end-cta-pill.name",
    "layer.end-cta.name": "editor.motion.templates.defaults.motion-end-screen.layer.end-cta.name",
    "layer.end-cta.text": "editor.motion.templates.defaults.motion-end-screen.layer.end-cta.text"
  }
};

/** Only newly constructed stock templates use localized defaults; saved content is never rewritten. */
export function createLocalizedMotionPreset(presetId: string, name?: string): MotionComposition | undefined {
  const preset = getMotionPreset(presetId);
  if (!preset) return undefined;
  const keys = presetDefaults[presetId];
  const composition = preset.create((field, fallback) => {
    const key = keys?.[field];
    return key ? editorMessage(key) : fallback;
  });
  return { ...composition, name: name ?? composition.name };
}
