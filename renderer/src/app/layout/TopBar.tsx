import { WindowControls } from "../components/WindowControls";

interface TopBarProps {
  platform: string;
}

export function TopBar({ platform }: TopBarProps) {
  return (
    <header
      className={`topbar${platform === "darwin" ? " is-mac" : ""}`}
      data-tauri-drag-region
    >
      <div className="window-drag-strip" data-tauri-drag-region />
      <div className="user-tools">
        {platform === "win32" && <WindowControls />}
      </div>
    </header>
  );
}
