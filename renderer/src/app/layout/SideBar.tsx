import { IconSymbol } from "../components/IconSymbol";
import { InteractiveLogo } from "../components/InteractiveLogo";
import {
  assetCategories,
  nodeTypes,
  projectWorkspaceItems,
} from "../constants/navigation";
import { type AppRoute, useAppStore } from "../store/appStore";

interface SideBarProps {
  onAddNode: (type: string) => void;
  onNotify: () => void;
  onSettings: () => void;
  onUpdate: () => void;
  onToggleSidebar: () => void;
  onNavigationBlocked?: () => void;
  previewOpen: boolean;
  previewClosing: boolean;
  onPreviewOpenChange: (open: boolean) => void;
}

export function SideBar(
  {
    onAddNode,
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
  const category = useAppStore((state) => state.assetCategory);
  const setRoute = useAppStore((state) => state.setRoute);
  const setCategory = useAppStore((state) => state.setAssetCategory);
  const iconRail = collapsed && !previewOpen;
  const pinnedOpen = !collapsed;

  function navigate(nextRoute: AppRoute) {
    if (!setRoute(nextRoute)) onNavigationBlocked?.();
  }

  const workspaceNavigation = (
    <>
      <div className="side-title">项目工作台</div>
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
      </div>
    </>
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
            <small>AI 创作工作台</small>
          </span>
        </div>
        <div className="sidebar-content">
          {route === "projects"
            ? (
              <>
              <div className="side-title">项目库</div>
              <div className="side-list">
                <button
                  className="side-item active"
                  onClick={() => navigate("projects")}
                >
                  <IconSymbol name="folder" />
                  <span>项目库</span>
                </button>
                <button
                  className="side-item"
                  disabled={!project}
                  title={project
                    ? "返回当前项目画布"
                    : "先在项目库中新建或打开项目"}
                  onClick={() => navigate("creation")}
                >
                  <IconSymbol name="grid" />
                  <span>继续创作</span>
                </button>
              </div>
              </>
            )
            : (
              <>
              <div className="side-list sidebar-back-list">
                <button
                  className="side-item sidebar-back-item"
                  title={iconRail ? "返回项目库" : undefined}
                  onClick={() => navigate("projects")}
                >
                  <IconSymbol name="chevron-left" />
                  <span>返回项目库</span>
                </button>
              </div>
              {workspaceNavigation}
              {route === "creation" && (
                <>
                  <div className="side-title">节点</div>
                  <div className="side-list">
                    {nodeTypes.map((item) => (
                      <button
                        key={item.id}
                        className="side-item"
                        title={iconRail ? item.label : undefined}
                        onClick={() => onAddNode(item.id)}
                      >
                        <IconSymbol name={item.icon} />
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {route === "assets" && (
                <>
                  <div className="side-title">素材分类</div>
                  <div className="side-list">
                    {assetCategories.map((item) => (
                      <button
                        key={item.id}
                        className={`side-item nested${
                          category === item.id ||
                            item.aliases.includes(category)
                            ? " active"
                            : ""
                        }`}
                        title={iconRail ? item.label : undefined}
                        onClick={() => setCategory(item.id)}
                      >
                        <IconSymbol name={item.icon} />
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              </>
            )}
        </div>
        <footer className="sidebar-footer">
          <button type="button" title="检查更新" onClick={onUpdate}>
            <IconSymbol name="package" />
            <span>检查更新</span>
          </button>
          <button type="button" title="通知" onClick={onNotify}>
            <IconSymbol name="bell" />
            <span>通知</span>
          </button>
          <button type="button" title="设置" onClick={onSettings}>
            <IconSymbol name="settings" />
            <span>设置</span>
          </button>
        </footer>
      </aside>
      {(!collapsed || previewOpen) && (
        <button
          className="sidebar-toggle"
          type="button"
          title={collapsed ? "固定左侧栏" : "收起左侧栏"}
          aria-label={collapsed ? "固定左侧栏" : "收起左侧栏"}
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
