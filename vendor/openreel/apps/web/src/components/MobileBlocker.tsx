import { editorMessage } from "../shotloom-mode";
import { useEffect, useState } from "react";
import { ToolcraftText as Text } from "@openreel/ui";

export function supportsBrowserEditing(): boolean {
  try {
    return typeof Blob !== "undefined" && typeof File !== "undefined" &&
      typeof URL.createObjectURL === "function" &&
      Boolean(document.createElement("canvas").getContext("2d"));
  } catch {
    return false;
  }
}

/** Gate missing browser APIs, allowing capable phones, tablets and computers. */
export function MobileBlocker() {
  const [unsupported, setUnsupported] = useState(false);
  useEffect(() => { setUnsupported(!supportsBrowserEditing()); }, []);
  if (!unsupported) return null;
  return (
    <div role="alert" className="fixed inset-0 z-[9999] bg-background flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <Text type="body" weight="bold" display="block">{editorMessage("editor.common.browserUpdate")}</Text>
        <Text type="supporting" display="block">{editorMessage("editor.common.browserRequirements")}</Text>
      </div>
    </div>
  );
}
