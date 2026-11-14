import { editorMessage } from "../../shotloom-mode";
import React from "react";
import {
  ToolcraftDropdownMenu as DropdownMenu,
  ToolcraftIconButton as IconButton,
  ToolcraftTooltip as Tooltip,
} from "@openreel/ui";
import { Icon } from "@/icons/Icon";
import {
  House,
  Sun,
  Moon,
  SunMoon,
  Settings,
  Circle,
  Play,
  Sparkles,
  HelpCircle,
  FileCode,
  Command,
} from "@/icons/lucide-compat";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useThemeStore } from "../../stores/theme-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useRouter } from "../../hooks/use-router";
import { isShotloomMode } from "../../shotloom-mode";
import {
  startTour,
  ONBOARDING_KEY,
  startMoGraphTour,
  MOGRAPH_TOUR_KEY,
} from "./tour";

// 参考剪辑台的左侧动作栏：64px 浅灰轨道、20px 线性图标、无分隔竖线。
const RAIL_ICON_SIZE = isShotloomMode ? 20 : 16;

const RailButton: React.FC<{
  label: string;
  icon: string;
  onClick: () => void;
  active?: boolean;
}> = ({ label, icon, onClick, active = false }) => (
  <Tooltip content={label} placement="end">
    <IconButton
      label={label}
      icon={<Icon name={icon} size={RAIL_ICON_SIZE} ariaHidden />}
      size="sm"
      variant={active ? "secondary" : "ghost"}
      onClick={onClick}
    />
  </Tooltip>
);

export const EditorActionRail: React.FC = () => {
  const { undo, redo } = useProjectStore();
  const {
    openModal,
    toggleKeyframeEditor,
    keyframeEditorOpen,
    panels,
    togglePanel,
    activeModal,
  } = useUIStore();
  const { mode: themeMode, toggleTheme } = useThemeStore();
  const { openSettings } = useSettingsStore();
  const { navigate } = useRouter();

  const themeLabels = { light: editorMessage("editor.actionRail.light"), dark: editorMessage("editor.actionRail.dark"), auto: editorMessage("editor.actionRail.system") };
  const themeLabel = themeLabels[themeMode];
  const nextThemeLabel = themeLabels[themeMode === "light" ? "dark" : themeMode === "dark" ? "auto" : "light"];
  const themeIcon =
    themeMode === "light" ? (
      <Sun size={16} aria-hidden />
    ) : themeMode === "dark" ? (
      <Moon size={16} aria-hidden />
    ) : (
      <SunMoon size={16} aria-hidden />
    );
  const themeActionLabel = editorMessage("editor.actionRail.themeAction", { current: themeLabel, next: nextThemeLabel });

  return (
    <nav
      data-tour="toolbar"
      aria-label={editorMessage("editor.actionRail.tools")}
      className={`flex shrink-0 flex-col items-center border-r border-border py-3 ${
        isShotloomMode ? "w-16 gap-2 bg-bg-2" : "w-12 gap-1 bg-bg-1"
      }`}
    >
      {!isShotloomMode && (
        <>
          <Tooltip content={editorMessage("editor.actionRail.home")} placement="end">
            <IconButton
              label={editorMessage("editor.actionRail.home")}
              icon={<House size={16} aria-hidden />}
              size="sm"
              variant="ghost"
              onClick={() => navigate("welcome")}
            />
          </Tooltip>

          <div className="my-1.5 h-px w-6 bg-border" />
        </>
      )}

      <RailButton
        label={editorMessage("editor.actionRail.search")}
        icon="magnifyingglass"
        onClick={() => openModal("search")}
      />
      <RailButton
        label={editorMessage("editor.actionRail.undo")}
        icon="arrow.uturn.backward"
        onClick={() => void undo()}
      />
      <RailButton
        label={editorMessage("editor.actionRail.redo")}
        icon="arrow.uturn.forward"
        onClick={() => void redo()}
      />

      {!isShotloomMode && <div className="my-1.5 h-px w-6 bg-border" />}

      <RailButton
        label={editorMessage("editor.actionRail.history")}
        icon="clock"
        onClick={() => openModal("history")}
        active={activeModal === "history"}
      />
      <RailButton
        label={editorMessage("editor.actionRail.keyframes")}
        icon="diamond"
        onClick={toggleKeyframeEditor}
        active={keyframeEditorOpen}
      />
      <RailButton
        label={editorMessage("editor.actionRail.mixer")}
        icon="music.note"
        onClick={() => togglePanel("audioMixer")}
        active={Boolean(panels.audioMixer?.visible)}
      />
      {!isShotloomMode && (
        <>
          <RailButton
            label={editorMessage("editor.actionRail.jsonComments")}
            icon="curlybraces"
            onClick={() => openModal("scriptView")}
          />
        </>
      )}

      <div className="flex-1" />

      {!isShotloomMode && (
        <>
      <Tooltip content={themeActionLabel} placement="end">
        <IconButton
          label={themeActionLabel}
          icon={themeIcon}
          size="sm"
          variant="secondary"
          onClick={toggleTheme}
        />
      </Tooltip>

      <DropdownMenu
        placement="end"
        button={{
          label: editorMessage("editor.actionRail.more"),
          icon: <Icon name="star" size={16} ariaHidden />,
          size: "sm",
          variant: "ghost",
          isIconOnly: true,
        }}
        hasChevron={false}
        menuWidth={224}
        items={[
          {
            label: editorMessage("editor.actionRail.settings"),
            icon: <Settings size={14} aria-hidden />,
            onClick: () => openSettings(),
          },
          {
            label: editorMessage("editor.actionRail.recorder"),
            icon: (
              <Circle
                size={14}
                className="fill-current text-status-error"
                aria-hidden
              />
            ),
            onClick: () => openModal("recorder"),
          },
          { type: "divider" },
          {
            label: editorMessage("editor.actionRail.tour"),
            icon: <Play size={14} aria-hidden />,
            onClick: () => {
              localStorage.removeItem(ONBOARDING_KEY);
              startTour();
            },
          },
          {
            label: editorMessage("editor.actionRail.animationTour"),
            icon: <Sparkles size={14} className="text-accent" aria-hidden />,
            onClick: () => {
              localStorage.removeItem(MOGRAPH_TOUR_KEY);
              startMoGraphTour();
            },
          },
          { type: "divider" },
          {
            label: editorMessage("editor.actionRail.help"),
            icon: <HelpCircle size={14} aria-hidden />,
            isDisabled: true,
          },
          {
            label: editorMessage("editor.actionRail.json"),
            icon: <FileCode size={14} aria-hidden />,
            isDisabled: true,
          },
          {
            label: editorMessage("editor.actionRail.searchShortcut"),
            icon: <Command size={14} aria-hidden />,
            isDisabled: true,
          },
        ]}
      />
        </>
      )}
    </nav>
  );
};
