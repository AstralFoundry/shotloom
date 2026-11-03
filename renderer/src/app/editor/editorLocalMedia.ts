import { t } from '@/i18n';
import { convertFileSrc } from "@tauri-apps/api/core";
import { desktopApi } from "../../services/desktopApi";
import { copyFileIntoProjectAssets, inferFileResourceType } from "../../store/assetStore";
import { store } from "../../store/projectStore";
import { showToast } from "../../store/notificationStore";
import { inferEditorMediaType, probeEditorMedia } from "../../utils/editorMediaImport";
import { projectAssetRoot } from "../../utils/assetPaths";
import type { VideoEditorAsset } from "./videoEditorTypes";

export const editorLocalMedia = {
        async recoverMediaFile(type: VideoEditorAsset["type"]): Promise<VideoEditorAsset | null> {
          const owner = store.project;
          const directory = store.projectDir;
          const root = projectAssetRoot(owner, directory);
          if (!root) throw new Error(t("ui.editorLocalMedia.text.6b324c49"));
          const assertOwner = () => {
            if (store.project !== owner || store.projectDir !== directory) throw new Error(t("ui.editorLocalMedia.text.30504998"));
          };
          const file = await desktopApi.file.pickResource(type);
          assertOwner();
          if (!file) return null;
          const original = String(file.filePath || file.path || "");
          const actualType = inferEditorMediaType(original);
          if (actualType !== type) throw new Error(t("ui.editorLocalMedia.text.730b2981"));
          const facts = await probeEditorMedia({ type, sourceFile: original, sourceUrl: convertFileSrc(original),
            readArrayBuffer: desktopApi.file.readArrayBuffer, probeNative: desktopApi.file.probeMedia });
          assertOwner();
          const copied = await desktopApi.file.copyToDirectory(original, root, file.name);
          assertOwner();
          const path = String(copied?.filePath || copied?.path || "");
          if (!path) throw new Error(t("ui.editorLocalMedia.text.c800913f"));
          return { id: `local:${path}`, type, name: file.name || t("ui.editorLocalMedia.text.d11f97db"), sourceFile: path, sourceUrl: convertFileSrc(path), ...facts };
        },
        async importDeviceFiles() {
          const files: any[] = await desktopApi.file.importAsset();
          const mediaFiles = files.filter((file: any) =>
            ["video", "audio", "image"].includes(inferFileResourceType(file))
          );
          const results = await Promise.allSettled(
            mediaFiles.map(async (file: any) => {
              const projectFile: any = await copyFileIntoProjectAssets(file);
              const sourceFile = String(projectFile.filePath || projectFile.path || "");
              if (!sourceFile) throw new Error(t("ui.editorLocalMedia.text.e0ec2a54"));
              const type = inferEditorMediaType(sourceFile);
              const sourceUrl = convertFileSrc(sourceFile);
              const facts = await probeEditorMedia({
                type,
                sourceFile,
                sourceUrl,
                readArrayBuffer: desktopApi.file.readArrayBuffer,
                probeNative: desktopApi.file.probeMedia,
              });
              return {
                // 本地上传没有画布来源 key，按真实文件路径认「已添加」，同一个文件不会重复入库。
                id: `local:${sourceFile}`,
                type,
                name: projectFile.name || file.name || sourceFile.split(/[\\/]/).pop() || t("ui.canvasAdapter.text.75e00c77"),
                sourceFile,
                sourceUrl,
                ...facts,
              };
            }),
          );
          const imported = results.flatMap((result) =>
            result.status === "fulfilled" ? [result.value] : []
          );
          const failed = results.length - imported.length;
          if (failed) {
            showToast(
              failed === results.length
                ? t("ui.editorLocalMedia.text.75875e93")
                : t("ui.editorLocalMedia.text.9dfba7f8", { value0: failed }),
            );
          }
          return imported;
        },
        async ingestEditorFiles(files: Array<{ name: string; mime?: string; bytes: ArrayBuffer }>) {
          const directory = String(store.projectDir || "");
          if (!directory) throw new Error(t("ui.editorLocalMedia.text.ea1f64df"));
          const imported: VideoEditorAsset[] = [];
          for (const [index, file] of files.entries()) {
            const safeName = String(file.name || `素材-${index + 1}`).replace(/[\\/:*?"<>|]/g, "-");
            const filePath = `${directory.replace(/[\\/]$/, "")}/assets/${Date.now().toString(36)}-${index}-${safeName}`;
            const written = await desktopApi.file.writeFileToPath(filePath, new Uint8Array(file.bytes));
            const path = String(written?.filePath || filePath);
            const type = inferEditorMediaType(path);
            const sourceUrl = convertFileSrc(path);
            const facts = await probeEditorMedia({
              type,
              sourceFile: path,
              sourceUrl,
              readArrayBuffer: desktopApi.file.readArrayBuffer,
              probeNative: desktopApi.file.probeMedia,
            });
            imported.push({
              id: `asset-ingest-${Date.now().toString(36)}-${index}`,
              type,
              name: safeName,
              sourceFile: path,
              sourceUrl,
              ...facts,
            });
          }
          return imported;
        },
};
