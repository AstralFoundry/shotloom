import { convertFileSrc } from "@tauri-apps/api/core";
import { desktopApi } from "./desktopApi.ts";

/**
 * 媒体预览图：一帧代表整段素材，供剪辑台素材选择器使用。按素材地址缓存，
 * 多个调用方引用同一素材都不会重复解码；失败返回空串，调用方退回纯色块。
 *
 * 桌面端先读本地文件再解码：素材地址可能是生成服务的远程 URL，带 crossOrigin
 * 的远程视频在 webview 里要么加载不了，要么把画布染成不可读，两种都拿不到帧。
 */
const posterCache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

const FRAME_WIDTH = 120;
const FRAME_TIMEOUT_MS = 4000;

export interface MediaPosterSource {
  sourceFile?: string;
  sourceUrl?: string;
}

/**
 * 就地预览用的可播放地址。本地文件走桌面端的资源协议——远程地址会过期，
 * 而且没有 CORS 头时根本放不出来。浏览器预览没有资源协议，退回远程地址。
 */
export function mediaSourceUrl(source: MediaPosterSource): string {
  const local = String(source?.sourceFile || "");
  if (local) {
    try {
      return convertFileSrc(local);
    } catch {
      return String(source?.sourceUrl || "");
    }
  }
  return String(source?.sourceUrl || "");
}

export function mediaPosterUrl(source: MediaPosterSource): Promise<string> {
  const key = String(source?.sourceFile || source?.sourceUrl || "");
  if (!key) return Promise.resolve("");
  const cached = posterCache.get(key);
  if (cached) return Promise.resolve(cached);
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const task = capture(source)
    .then((value) => {
      if (value) posterCache.set(key, value);
      return value;
    })
    .catch(() => "");
  pending.set(key, task);
  return task.finally(() => {
    pending.delete(key);
  });
}

/**
 * 解码用的 <video> 必须真的在文档里被栅格化过，`drawImage` 才拿得到画面：
 * 游离元素在部分引擎上永远画出黑帧。把它压到屏幕外 1px 并透明，
 * 既进渲染树又不占位、不闪一下。
 */
function attachHidden(video: HTMLVideoElement): () => void {
  video.style.position = "fixed";
  video.style.top = "0";
  video.style.left = "0";
  video.style.width = "1px";
  video.style.height = "1px";
  video.style.opacity = "0";
  video.style.pointerEvents = "none";
  document.body.appendChild(video);
  return () => {
    video.remove();
  };
}

async function capture(source: MediaPosterSource): Promise<string> {
  const local = String(source.sourceFile || "");
  if (local) {
    const bytes = await readLocal(local);
    if (bytes) {
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeOf(local) }));
      try {
        return await decode(url, true);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }
  const remote = String(source.sourceUrl || "");
  return remote ? decode(remote, false) : "";
}

async function readLocal(path: string): Promise<ArrayBuffer | null> {
  try {
    const buffer = await desktopApi.file.readArrayBuffer(path);
    return buffer && buffer.byteLength > 0 ? buffer : null;
  } catch {
    return null;
  }
}

function mimeOf(path: string): string {
  const extension = String(path.split(/[?#]/).pop() || "").toLowerCase().split(".").pop() || "";
  if (extension === "mov") return "video/quicktime";
  if (extension === "webm") return "video/webm";
  if (extension === "m4a" || extension === "mp3" || extension === "wav") return `audio/${extension}`;
  return "video/mp4";
}

/**
 * 取三段画面拼成一条胶片带。blob 地址是同源的，画布可以读回；
 * 远程地址只能退成一帧，并且随时可能被浏览器判定为不可读。
 */
function decode(url: string, filmstrip: boolean): Promise<string> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const detach = attachHidden(video);
    let settled = false;
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      detach();
      video.removeAttribute("src");
      video.load();
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(""), FRAME_TIMEOUT_MS * 3);
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    if (!url.startsWith("blob:")) video.crossOrigin = "anonymous";
    video.onloadeddata = () => {
      void drawFrames(video, filmstrip).then(finish, () => finish(""));
    };
    video.onerror = () => finish("");
    video.src = url;
  });
}

async function drawFrames(video: HTMLVideoElement, filmstrip: boolean): Promise<string> {
  const duration = Number(video.duration) || 0;
  const fractions = filmstrip ? [0.1, 0.5, 0.9] : [Math.min(0.1, duration ? 0.1 : 0)];
  const width = video.videoWidth || FRAME_WIDTH;
  const height = video.videoHeight || Math.round((FRAME_WIDTH * 9) / 16);
  const frameWidth = FRAME_WIDTH;
  const frameHeight = Math.max(1, Math.round((frameWidth * height) / width));
  const canvas = document.createElement("canvas");
  canvas.width = frameWidth * fractions.length;
  canvas.height = frameHeight;
  const context = canvas.getContext("2d");
  if (!context) return "";
  for (const [index, fraction] of fractions.entries()) {
    if (duration) await seek(video, duration * fraction);
    context.drawImage(video, index * frameWidth, 0, frameWidth, frameHeight);
  }
  return canvas.toDataURL("image/jpeg", 0.62);
}

function seek(video: HTMLVideoElement, seconds: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", done);
      resolve();
    };
    const timer = window.setTimeout(done, FRAME_TIMEOUT_MS);
    video.addEventListener("seeked", done, { once: true });
    try {
      video.currentTime = seconds;
    } catch {
      done();
    }
  });
}
