import { afterEach, describe, expect, it } from "vitest";
import { getBuiltInEditingTemplates, type EditingTemplate } from "@openreel/core";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { editingTemplateText, editingTemplateControlLabel } from "./editing-template-labels";

const templates = getBuiltInEditingTemplates();
afterEach(() => configureShotloomLocale("en-US"));
describe("built-in recipe labels", () => {
  it.each(templates.map((template) => [template.id, template] as const))("translates display fields for %s without changing the recipe", (_id, template) => {
    const source = JSON.stringify(template);
    configureShotloomLocale("en-US");
    expect(editingTemplateText(template, "name")).toBe(template.name);
    expect(editingTemplateText(template, "description")).toBe(template.description);
    configureShotloomLocale("zh-CN");
    expect(editingTemplateText(template, "name")).not.toBe(template.name);
    expect(editingTemplateText(template, "description")).not.toBe(template.description);
    for (const control of template.controls ?? []) {
      const translated = editingTemplateControlLabel(template, control);
      expect(translated.length).toBeGreaterThan(0);
      expect(translated).not.toBe(control.label);
    }
    expect(JSON.stringify(template)).toBe(source);
  });

  it("preserves edited built-in fields and authored controls independently", () => {
    configureShotloomLocale("zh-CN");
    const template = templates.find((item) => item.id === "cinema-letterbox")!;
    const custom = { ...template, name: "My film bars", description: "User text", controls: template.controls!.map((control) => ({ ...control, label: "My control" })) };
    expect(editingTemplateText(custom, "name")).toBe(custom.name);
    expect(editingTemplateText(custom, "description")).toBe(custom.description);
    expect(editingTemplateControlLabel(custom, custom.controls[0])).toBe("My control");
    expect(editingTemplateText({ ...template, name: "My film bars" }, "description")).not.toBe(template.description);
  });

  it.each(["custom-recipe", "constructor", "__proto__"])("preserves unknown template %s", (id) => {
    configureShotloomLocale("zh-CN");
    const custom: EditingTemplate = { ...templates[0], id };
    expect(editingTemplateText(custom, "name")).toBe(custom.name);
    expect(editingTemplateControlLabel(custom, custom.controls![0])).toBe(custom.controls![0].label);
  });
});
