#!/usr/bin/env node
/**
 * 构建 vendored OpenReel 并同步到 renderer/public/openreel。
 *
 * OpenReel 是独立的 pnpm workspace，不能用根项目的 npm 依赖构建：
 * - 使用 vendor packageManager 声明的 pnpm 版本；
 * - 先生成 core 的 wasm（音频 FFT/WAV/节拍）；
 * - OPENREEL_DESKTOP=1 让 Vite 使用相对 base、本地字体，并去掉外部 ffmpeg 回退；
 * - OPENREEL_EMBEDDED=1 单独构建 ShadowRoot runtime，inlineDynamicImports 让每个
 *   工厂闭包为每个节点创建独立模块图和 store，不依赖 iframe 或 eval。
 *
 * 用内容 hash 做 stamp：第二次 npm run dev 不会重复安装/构建。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prepareOpenReelAgent, runOpenReelPnpm } from './prepare-openreel-agent.mjs';
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendor = path.join(root, "vendor", "openreel");
const webDir = path.join(vendor, "apps", "web");
const embeddedDist = path.join(webDir, "dist-embedded");
const target = path.join(root, "renderer", "public", "openreel");
const stampFile = path.join(target, ".shotloom-build.json");
await prepareOpenReelAgent();

const HASH_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "apps/web/package.json",
  "apps/web/vite.config.ts",
  "apps/web/index.html",
  "packages/core/package.json",
  "packages/core/src/types/actions.ts",
  "apps/web/src/main.tsx",
  "apps/web/src/shotloom-bridge.ts",
  "apps/web/src/embedded/runtime-types.ts",
  "apps/web/src/embedded/dom.ts",
  "apps/web/src/shotloom-theme.css",
  "apps/web/src/shotloom-mode.ts",
  "apps/web/src/shotloom-action-catalog.ts",
  "apps/web/src/hooks/useEditorInitialization.ts",
  "apps/web/src/hooks/useProjectRecovery.ts",
  "apps/web/src/hooks/useKeyboardShortcuts.ts",
  "apps/web/src/components/editor/EditorInterface.tsx",
  "apps/web/src/components/editor/AssetsPanel.tsx",
  "apps/web/src/components/editor/EditorActionRail.tsx",
];

const HASH_DIRS = [
  // Product bridge messages are compiled into each isolated editor factory.
  "../../renderer/src/i18n",
  "packages/agent/src",
  "packages/creation-schema/src",
  "apps/web/src",
  "apps/web/vite-plugins",
  "packages/core/src",
  "packages/ui/src",
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, out);
    else if (/\.(ts|tsx|css|json|html)$/.test(entry.name)) out.push(file);
  }
  return out;
}

function sourceHash() {
  const hash = createHash("sha256");
  const files = new Set(HASH_FILES.map((file) => path.join(vendor, file)));
  for (const dir of HASH_DIRS) {
    for (const file of walk(path.join(vendor, dir))) files.add(file);
  }
  for (const file of [...files].sort()) {
    if (!fs.existsSync(file)) continue;
    hash.update(path.relative(vendor, file));
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  hash.update(fs.readFileSync(path.join(root, "scripts", "prepare-openreel.mjs")));
  return hash.digest("hex");
}

function readStamp() {
  try {
    return JSON.parse(fs.readFileSync(stampFile, "utf8"));
  } catch {
    return null;
  }
}

function outputLooksValid() {
  if (!fs.existsSync(path.join(target, "embedded-runtime.js"))) return false;
  const assets = path.join(target, "assets");
  if (!fs.existsSync(assets)) return false;
  const wasm = fs.readdirSync(assets, { recursive: true }).filter((file) => String(file).endsWith(".wasm"));
  return wasm.length > 0;
}

function copyDir(source, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
}

function main() {
  if (!fs.existsSync(vendor)) {
    console.error("缺少 vendor/openreel；先恢复 vendored 源码。");
    process.exit(1);
  }
  const hash = sourceHash();
  const stamp = readStamp();
  if (stamp?.hash === hash && outputLooksValid()) {
    console.log("[openreel] 产物已是最新，跳过构建。");
    return;
  }

  console.log("[openreel] 构建 wasm…");
  runOpenReelPnpm(["--filter", "@openreel/core", "build:wasm"]);
  console.log("[openreel] 构建 ShadowRoot runtime…");
  runOpenReelPnpm(["--filter", "@openreel/web", "build:embedded"], { OPENREEL_EMBEDDED: "1" });
  if (!fs.existsSync(path.join(embeddedDist, "embedded-runtime.js"))) {
    throw new Error("ShadowRoot runtime 构建没有产出 embedded-runtime.js");
  }
  copyDir(embeddedDist, target);
  fs.writeFileSync(
    stampFile,
    JSON.stringify({ hash, builtAt: new Date().toISOString() }, null, 2),
  );
  if (!outputLooksValid()) {
    throw new Error("OpenReel 产物校验失败：缺少 wasm、绝对路径或仍引用外部字体");
  }
  console.log("[openreel] 完成。");
}

try {
  main();
} catch (error) {
  console.error("[openreel]", error instanceof Error ? error.message : error);
  process.exit(1);
}
