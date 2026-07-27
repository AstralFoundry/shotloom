import { useEffect, useState } from "react";
import { desktopApi } from "../../services/desktopApi.js";

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
        title="最小化"
        onClick={() => desktopApi.window.minimize?.()}
      >
        −
      </button>
      <button
        className="icon-btn win-control"
        title={isMaximized ? "还原" : "最大化"}
        onClick={toggleMaximize}
      >
        {isMaximized ? "❐" : "□"}
      </button>
      <button
        className="icon-btn win-control close"
        title="关闭"
        onClick={() => desktopApi.window.close?.()}
      >
        ×
      </button>
    </div>
  );
}
