import { t } from '@/i18n';
import { useContext, type RefObject } from "react";
import { desktopApi } from "../../services/desktopApi.ts";
import { ImageCropEditor } from "../components/ImageCropEditor";
import { ImageAnnotationEditor, ImageAnnotationOverlay, type ImageAnnotation } from "../components/ImageAnnotationEditor";
import { ImageWatermarkEditor } from "../components/ImageWatermarkEditor";
import { readImageRecipe } from '@/domain/graph/imageRecipe';
import { listMaskEditModels } from '@/domain/graph/imageMask';
import { showToast } from '@/store/notificationStore';
import { ImageAnglePanel } from "./ImageAnglePanel";
import { ImageLightingPanel } from "./ImageLightingPanel";
import { ImageMaskEditor } from "./ImageMaskEditor";
import { ImageEmotionEditor } from "./ImageEmotionEditor";
import { CanvasOverlayRootContext, type WorkflowNodeActions, type WorkflowNodeData } from "./WorkflowCanvas";

/**
 * 本地图片的编辑覆盖层：裁剪保留来源连线由 action 负责，
 * 标注有两条出路——写回本节点（预览优先用标注图），或把合成结果存成新素材并
 * 派生一个不改动原节点的图片节点。
 */
export function GenerationNodeImageOverlays({
  node,
  actions,
  activeKind,
  activeFilePath,
  previewUrl,
  imageWidth,
  imageHeight,
  semanticZoom,
  anchorRef,
  imageCropMode,
  onImageCropClose,
  imageAnnotationOpen,
  onImageAnnotationClose,
  imageWatermarkOpen,
  onImageWatermarkClose,
  imageAngleOpen,
  onImageAngleClose,
  imageLightingOpen,
  onImageLightingClose,
  imageMaskOpen,
  onImageMaskClose,
  imageEmotionOpen,
  onImageEmotionClose,
}: {
  node: WorkflowNodeData;
  actions: WorkflowNodeActions;
  activeKind: string;
  activeFilePath: string;
  previewUrl: string;
  imageWidth: number;
  imageHeight: number;
  semanticZoom: number;
  anchorRef: RefObject<HTMLDivElement | null>;
  imageCropMode: "crop" | "grid" | null;
  onImageCropClose: (() => void) | undefined;
  imageAnnotationOpen: boolean;
  onImageAnnotationClose: (() => void) | undefined;
  imageWatermarkOpen: boolean;
  onImageWatermarkClose: (() => void) | undefined;
  imageAngleOpen: boolean;
  onImageAngleClose: (() => void) | undefined;
  imageLightingOpen: boolean;
  onImageLightingClose: (() => void) | undefined;
  imageMaskOpen: boolean;
  onImageMaskClose: (() => void) | undefined;
  imageEmotionOpen: boolean;
  onImageEmotionClose: (() => void) | undefined;
}) {
  const root = useContext(CanvasOverlayRootContext);
  const isImagePreview = activeKind === "image" && Boolean(previewUrl);
  const recipe = readImageRecipe(node.imageRecipe);
  const maskModels = listMaskEditModels();
  return (
    <>
      {imageCropMode && isImagePreview && activeFilePath && (
        <ImageCropEditor
          nodeId={node.id}
          root={root}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          initialMode={imageCropMode}
          onCancel={() => onImageCropClose?.()}
          onConfirm={(rect) => actions.cropImage(node.id, rect)}
          onSplit={(rows, cols, selected, rect) => actions.splitImageGrid(node.id, rows, cols, selected, rect)}
        />
      )}
      {isImagePreview && !imageAnnotationOpen && Array.isArray(node.annotationData) && (
        <ImageAnnotationOverlay annotations={node.annotationData as ImageAnnotation[]} />
      )}
      {imageWatermarkOpen && isImagePreview && (
        <ImageWatermarkEditor
          imageUrl={previewUrl}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          semanticZoom={semanticZoom}
          root={root}
          anchorRef={anchorRef}
          onCancel={() => onImageWatermarkClose?.()}
          onApply={async (blob) => {
            if (await actions.createWatermarkNode(node.id, blob)) onImageWatermarkClose?.();
          }}
        />
      )}
      {imageAngleOpen && isImagePreview && (
        <ImageAnglePanel
          key={`${node.id}-angle`}
          root={root}
          anchorRef={anchorRef}
          imageUrl={previewUrl}
          {...(recipe?.kind === "angle" ? { initialParams: recipe.params } : {})}
          onClose={() => onImageAngleClose?.()}
          onConfirm={(params) => {
            if (actions.applyImageRecipe(node.id, "angle", params)) onImageAngleClose?.();
          }}
        />
      )}
      {imageLightingOpen && isImagePreview && (
        <ImageLightingPanel
          key={`${node.id}-lighting`}
          root={root}
          anchorRef={anchorRef}
          imageUrl={previewUrl}
          {...(recipe?.kind === "lighting" ? { initialOptions: recipe.params } : {})}
          onClose={() => onImageLightingClose?.()}
          onConfirm={(options) => {
            if (actions.applyImageRecipe(node.id, "lighting", options)) onImageLightingClose?.();
          }}
        />
      )}
      {imageMaskOpen && isImagePreview && imageWidth > 0 && imageHeight > 0 && (
        <ImageMaskEditor
          key={`${node.id}-mask`}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          semanticZoom={semanticZoom}
          root={root}
          anchorRef={anchorRef}
          models={maskModels}
          initialModel={String(node.model || '')}
          nodeId={node.id}
          actions={actions}
          onCancel={() => onImageMaskClose?.()}
          onApply={async ({ prompt, maskDataUrl, model, config }) => {
            const preferredName = `${String(node.title || "image").replace(/[\\/:*?"<>|]/g, "_")}-mask.png`;
            const saved = await desktopApi.file.saveDataUrlToProject(maskDataUrl, preferredName);
            const maskFilePath = String(saved?.filePath || saved?.path || "");
            if (!maskFilePath) {
              showToast(t("imageMask.error.saveMask"), "error");
              return false;
            }
            if (!actions.applyMaskEdit(node.id, { prompt, maskFilePath, model, config })) return false;
            onImageMaskClose?.();
            return true;
          }}
        />
      )}
      {imageEmotionOpen && isImagePreview && imageWidth > 0 && imageHeight > 0 && (
        <ImageEmotionEditor
          key={`${node.id}-emotion`}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          root={root}
          anchorRef={anchorRef}
          model={String(node.model || "")}
          modelSupported={maskModels.includes(String(node.model || ""))}
          onCancel={() => onImageEmotionClose?.()}
          onApply={async ({ maskDataUrl, presetId, extraPrompt, faceRect }) => {
            const preferredName = `${String(node.title || "image").replace(/[\\/:*?"<>|]/g, "_")}-emotion-mask.png`;
            const saved = await desktopApi.file.saveDataUrlToProject(maskDataUrl, preferredName);
            const maskFilePath = String(saved?.filePath || saved?.path || "");
            if (!maskFilePath) {
              showToast(t("imageEmotion.error.saveMask"), "error");
              return false;
            }
            if (!actions.applyEmotionEdit(node.id, { maskFilePath, presetId, extraPrompt, faceRect })) return false;
            onImageEmotionClose?.();
            return true;
          }}
        />
      )}
      {imageAnnotationOpen && isImagePreview && (
        <ImageAnnotationEditor
          imageUrl={previewUrl}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          semanticZoom={semanticZoom}
          root={root}
          anchorRef={anchorRef}
          onCancel={() => onImageAnnotationClose?.()}
          onCreateNode={async ({ blob }) => {
            if (await actions.createAnnotationNode(node.id, blob)) onImageAnnotationClose?.();
          }}
          onSave={async ({ blob }) => {
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result || ""));
              reader.onerror = () => reject(reader.error || new Error(t("ui.GenerationNodeImageOverlays.text.8173b72b")));
              reader.readAsDataURL(blob);
            });
            const preferredName = `${String(node.title || "image").replace(/[\\/:*?"<>|]/g, "_")}-annotated.png`;
            const saved = await desktopApi.file.saveDataUrlToProject(dataUrl, preferredName);
            actions.update(node.id, {
              annotationData: [],
              annotationImagePath: String(saved?.filePath || saved?.path || ""),
              annotationImageUrl: dataUrl,
              updatedAt: new Date().toISOString(),
            });
            onImageAnnotationClose?.();
          }}
        />
      )}
    </>
  );
}
