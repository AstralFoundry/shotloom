import { t } from '@/i18n';
import { useEffect, useState } from "react";
import { desktopApi } from "../../services/desktopApi.ts";

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    void desktopApi.window.isMaximized?.().then(setIsMaximized);
    return desktopApi.window.onMaximizedChange?.((value: unknown) =>
      setIsMaximized(Boolean(value))
    );
  }, []);

  async function toggleMaximize() {
    setIsMaximized(await desktopApi.window.maximize?.());
  }

  return (
    <div className="window-controls">
      <button
        className="icon-btn win-control"
        title={t("ui.WindowControls.title.ca8223c5")}
        onClick={() => desktopApi.window.minimize?.()}
      >
        −
      </button>
      <button
        className="icon-btn win-control"
        title={isMaximized ? t("ui.WindowControls.text.457d449c") : t("ui.WindowControls.text.da2d806e")}
        onClick={toggleMaximize}
      >
        {isMaximized ? "❐" : "□"}
      </button>
      <button
        className="icon-btn win-control close"
        title={t("ui.CanvasToolbarCustomizeDialog.arialabel.6c14bd7f")}
        onClick={() => desktopApi.window.close?.()}
      >
        ×
      </button>
    </div>
  );
}
