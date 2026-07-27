import { type ReactNode, useEffect, useRef, useState } from "react";
import { SideBar } from "./layout/SideBar";
import { TopBar } from "./layout/TopBar";
import { type AppRoute, useAppStore } from "./store/appStore";

interface AppShellProps {
  platform: string;
  views: Record<AppRoute, ReactNode>;
  onAddNode: (type: string) => void;
  onNotify: () => void;
  onSettings: () => void;
  onUpdate: () => void;
  onNavigationBlocked?: () => void;
}

export function AppShell(
  {
    platform,
    views,
    onAddNode,
    onNotify,
    onSettings,
    onUpdate,
    onNavigationBlocked,
  }: AppShellProps,
) {
  const route = useAppStore((state) => state.route);
  const collapsed = useAppStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const [sidebarPreviewOpen, setSidebarPreviewOpen] = useState(false);
  const [sidebarPreviewClosing, setSidebarPreviewClosing] = useState(false);
  const sidebarPreviewTimer = useRef<number | null>(null);
  const effectiveCollapsed = collapsed;
  const sidebarPinnedOpen = !collapsed;
  const overlaySidebar = route === "creation";

  useEffect(() => {
    if (effectiveCollapsed) return;
    if (sidebarPreviewTimer.current !== null) {
      window.clearTimeout(sidebarPreviewTimer.current);
      sidebarPreviewTimer.current = null;
    }
    setSidebarPreviewOpen(false);
    setSidebarPreviewClosing(false);
  }, [effectiveCollapsed]);

  useEffect(() => () => {
    if (sidebarPreviewTimer.current !== null) {
      window.clearTimeout(sidebarPreviewTimer.current);
    }
  }, []);

  function changeSidebarPreview(open: boolean) {
    if (sidebarPreviewTimer.current !== null) {
      window.clearTimeout(sidebarPreviewTimer.current);
      sidebarPreviewTimer.current = null;
    }
    if (open) {
      setSidebarPreviewOpen(true);
      setSidebarPreviewClosing(false);
      return;
    }
    if (!sidebarPreviewOpen) return;
    setSidebarPreviewClosing(true);
    sidebarPreviewTimer.current = window.setTimeout(() => {
      setSidebarPreviewOpen(false);
      setSidebarPreviewClosing(false);
      sidebarPreviewTimer.current = null;
    }, 220);
  }

  function toggleSidebarWithTransition() {
    if (sidebarPreviewTimer.current !== null) {
      window.clearTimeout(sidebarPreviewTimer.current);
      sidebarPreviewTimer.current = null;
    }

    if (collapsed) {
      setSidebarPreviewOpen(false);
      setSidebarPreviewClosing(false);
      toggleSidebar();
      return;
    }

    // Keep the expanded geometry mounted while the drawer contracts. Switching
    // to rail geometry on the first frame makes the logo and controls visibly jump.
    setSidebarPreviewOpen(true);
    setSidebarPreviewClosing(true);
    toggleSidebar();
    sidebarPreviewTimer.current = window.setTimeout(() => {
      setSidebarPreviewOpen(false);
      setSidebarPreviewClosing(false);
      sidebarPreviewTimer.current = null;
    }, 220);
  }

  const previewActive = effectiveCollapsed && sidebarPreviewOpen;
  return (
    <div
      className={`app-shell route-${route}${overlaySidebar ? " sidebar-overlay-shell" : ""} sidebar-is-collapsed${
        sidebarPinnedOpen ? " sidebar-is-pinned" : ""
      }${
        previewActive && !sidebarPreviewClosing ? " sidebar-preview-open" : ""
      }${
        previewActive && sidebarPreviewClosing ? " sidebar-preview-closing" : ""
      }`}
    >
      <TopBar platform={platform} />
      <main
        className="workspace sidebar-collapsed"
      >
        <SideBar
          onAddNode={onAddNode}
          onNotify={onNotify}
          onSettings={onSettings}
          onUpdate={onUpdate}
          onToggleSidebar={toggleSidebarWithTransition}
          onNavigationBlocked={onNavigationBlocked}
          previewOpen={previewActive}
          previewClosing={previewActive && sidebarPreviewClosing}
          onPreviewOpenChange={changeSidebarPreview}
        />
        <section className="content">{views[route]}</section>
      </main>
    </div>
  );
}
