import { editorMessage } from "../../../shotloom-mode";
import React from "react";
import { Maximize2 } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutContent as LayoutContent, ToolcraftLayoutFooter as LayoutFooter } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";

interface AspectRatioMatchDialogProps {
  isOpen: boolean;
  videoWidth: number;
  videoHeight: number;
  currentWidth: number;
  currentHeight: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export const AspectRatioMatchDialog: React.FC<AspectRatioMatchDialogProps> = ({
  isOpen,
  videoWidth,
  videoHeight,
  currentWidth,
  currentHeight,
  onConfirm,
  onCancel,
}) => {
  const videoAspect = (videoWidth / videoHeight).toFixed(2);
  const currentAspect = (currentWidth / currentHeight).toFixed(2);

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open) => !open && onCancel()}
      width={448}
      purpose="form"
    >
      <Layout
        header={
          <DialogHeader
            title={editorMessage("editor.dimensions.title")}
            subtitle={editorMessage("editor.dimensions.subtitle")}
            onOpenChange={(open) => !open && onCancel()}
            startContent={<Maximize2 size={20} className="text-primary" aria-hidden />}
          />
        }
        content={
          <LayoutContent>
        <div className="space-y-4">
          <div className="space-y-3">
            <Card variant="muted" padding={3}>
              <div>
                <Text type="supporting" color="secondary" display="block" className="mb-1">
                  {editorMessage("editor.dimensions.video")}
                </Text>
                <Text type="label" weight="bold" display="block">
                  {videoWidth} x {videoHeight}
                </Text>
                <Text type="supporting" color="secondary" display="block" className="mt-0.5">
                  {editorMessage("editor.dimensions.ratio", { ratio: videoAspect })}
                </Text>
              </div>
            </Card>

            <Card variant="default" padding={3} className="border border-border/50">
              <div>
                <Text type="supporting" color="secondary" display="block" className="mb-1">
                  {editorMessage("editor.dimensions.current")}
                </Text>
                <Text type="label" weight="bold" display="block">
                  {currentWidth} x {currentHeight}
                </Text>
                <Text type="supporting" color="secondary" display="block" className="mt-0.5">
                  {editorMessage("editor.dimensions.ratio", { ratio: currentAspect })}
                </Text>
              </div>
            </Card>
          </div>

          <Text type="supporting" color="secondary" display="block">
            {editorMessage("editor.dimensions.description")}
          </Text>
        </div>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <div className="flex gap-3">
              <Button
                label={editorMessage("editor.dimensions.keep")}
                variant="secondary"
                className="flex-1"
                onClick={onCancel}
              />
              <Button
                label={editorMessage("editor.dimensions.match")}
                variant="primary"
                className="flex-1"
                onClick={onConfirm}
              />
            </div>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
};
