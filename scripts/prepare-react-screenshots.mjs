import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageRoot = join(root, "node_modules", "react-screenshots");
const cssDir = join(packageRoot, "dist", "static", "css");
if (!existsSync(cssDir)) process.exit(0);
const cssFile = readdirSync(cssDir).find((name) => name.endsWith(".css"));
if (!cssFile) process.exit(0);
const css = readFileSync(join(cssDir, cssFile), "utf8");
const targets = [
  "lib/Screenshots/icons/iconfont.css",
  "lib/Screenshots/screenshots.css",
  "lib/Screenshots/ScreenshotsOperations/index.css",
  "lib/Screenshots/ScreenshotsMagnifier/index.css",
  "lib/Screenshots/ScreenshotsButton/index.css",
  "lib/Screenshots/ScreenshotsTextarea/index.css",
  "lib/Screenshots/ScreenshotsCanvas/index.css",
  "lib/Screenshots/ScreenshotsSize/index.css",
  "lib/Screenshots/ScreenshotsBackground/index.css",
  "lib/Screenshots/ScreenshotsColor/index.css",
  "lib/Screenshots/ScreenshotsOption/index.css",
  "lib/Screenshots/ScreenshotsSizeColor/index.css",
];
for (const relative of targets) {
  const file = join(packageRoot, relative);
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, css);
  }
}
