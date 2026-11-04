import { t } from '@/i18n';
import { IconSymbol } from "../components/IconSymbol";
import { InteractiveLogo } from "../components/InteractiveLogo";
import { projectWorkspaceItems } from "../constants/navigation";
import { type AppRoute, useAppStore } from "../store/appStore";

interface SideBarProps {
  onVideoEdit: () => void;
  onNotify: () => void;
  onSettings: () => void;
  onUpdate: () => void;
  onToggleSidebar: () => void;
  onNavigationBlocked?: (() => void) | undefined;
  previewOpen: boolean;
  previewClosing: boolean;
  onPreviewOpenChange: (open: boolean) => void;
}

export function SideBar(
  {
    onVideoEdit,
    onNotify,
    onSettings,
    onUpdate,
    onToggleSidebar,
    onNavigationBlocked,
    previewOpen,
    previewClosing,
    onPreviewOpenChange,
  }: SideBarProps,
) {
  const route = useAppStore((state) => state.route);
  const project = useAppStore((state) => state.currentProject);
  const collapsed = useAppStore((state) => state.sidebarCollapsed);
  const setRoute = useAppStore((state) => state.setRoute);
  const iconRail = collapsed && !previewOpen;
  const pinnedOpen = !collapsed;

  function navigate(nextRoute: AppRoute) {
    if (!setRoute(nextRoute)) onNavigationBlocked?.();
  }

  const workspaceNavigation = (
    <div className="side-list">
        {projectWorkspaceItems.map((item) => (
          <button
            key={item.id}
            className={`side-item${route === item.id ? " active" : ""}`}
            title={iconRail ? item.label : undefined}
            onClick={() => navigate(item.id)}
          >
            <IconSymbol name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
        {route === "creation" && (
          <button
            className="side-item"
            title={iconRail ? t("ui.ReactWorkbench.text.3d65ff77") : undefined}
            onClick={onVideoEdit}
          >
            <IconSymbol name="scissors" />
            <span>{t("ui.ReactWorkbench.text.3d65ff77")}</span>
          </button>
        )}
    </div>
  );

  return (
    <div
      className={`sidebar-shell${iconRail ? " collapsed" : ""}${
        previewOpen && !previewClosing ? " preview-open" : ""
      }${previewClosing ? " preview-closing" : ""}${
        pinnedOpen ? " pinned-open" : ""
      }`}
      onMouseEnter={() => {
        if (collapsed) onPreviewOpenChange(true);
      }}
      onMouseLeave={() => {
        if (collapsed) onPreviewOpenChange(false);
      }}
    >
      <aside className="sidebar">
        <div className="sidebar-brand" title="Shotloom">
          <InteractiveLogo src="./shotloom-logo.png" />
          <span className="sidebar-brand-copy">
            <strong>Shotloom</strong>
            <small>{t("ui.SideBar.text.63130267")}</small>
          </span>
        </div>
        <div className="sidebar-content">
          {route === "projects"
            ? (
              <>
              <div className="side-list">
                <button
                  className="side-item active"
                  onClick={() => navigate("projects")}
                >
                  <IconSymbol name="folder" />
                  <span>{t("ui.ProjectScopeHeader.text.79b705bd")}</span>
                </button>
                <button
                  className="side-item"
                  disabled={!project}
                  title={project
                    ? t("ui.SideBar.text.d5475e65")
                    : t("ui.SideBar.text.b245e5b7")}
                  onClick={() => navigate("creation")}
                >
                  <IconSymbol name="grid" />
                  <span>{t("ui.SideBar.text.01886415")}</span>
                </button>
              </div>
              </>
            )
            : (
              <>
              <div className="side-list sidebar-back-list">
                <button
                  className="side-item sidebar-back-item"
                  title={iconRail ? t("ui.SideBar.text.94c32741") : undefined}
                  onClick={() => navigate("projects")}
                >
                  <IconSymbol name="chevron-left" />
                  <span>{t("ui.SideBar.text.94c32741")}</span>
                </button>
              </div>
              {workspaceNavigation}
              </>
            )}
        </div>
        <footer className="sidebar-footer">
          <button type="button" title={t("ui.SideBar.title.a6df3858")} onClick={onUpdate}>
            <IconSymbol name="package" />
            <span>{t("ui.SideBar.title.a6df3858")}</span>
          </button>
          <button type="button" title={t("ui.SideBar.title.7a66c0d0")} onClick={onNotify}>
            <IconSymbol name="bell" />
            <span>{t("ui.SideBar.title.7a66c0d0")}</span>
          </button>
          <button type="button" title={t("ui.SideBar.title.7debf9cb")} onClick={onSettings}>
            <IconSymbol name="settings" />
            <span>{t("ui.SideBar.title.7debf9cb")}</span>
          </button>
        </footer>
      </aside>
      {(!collapsed || previewOpen) && (
        <button
          className="sidebar-toggle"
          type="button"
          title={collapsed ? t("ui.SideBar.text.71eb990b") : t("ui.SideBar.text.761fe9aa")}
          aria-label={collapsed ? t("ui.SideBar.text.71eb990b") : t("ui.SideBar.text.761fe9aa")}
          onClick={() => {
            onToggleSidebar();
          }}
        >
          <svg
            className="sidebar-visibility-icon"
            viewBox="0 0 18 18"
            aria-hidden="true"
          >
            <rect
              className="sidebar-visibility-frame"
              x="1.25"
              y="2.25"
              width="15.5"
              height="13.5"
              rx="3"
            />
            <rect
              className="sidebar-visibility-fill"
              x="2.75"
              y="3.75"
              width="5.25"
              height="10.5"
              rx="1.5"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
