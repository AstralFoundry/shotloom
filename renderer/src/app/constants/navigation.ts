import { t } from '@/i18n';
import type { IconName } from "../components/IconSymbol";
import type { AppRoute } from "../store/appStore";

export interface NavigationItem {
  id: AppRoute;
  label: string;
  icon: IconName;
  description: string;
}

export const projectWorkspaceItems: NavigationItem[] = [
  {
    id: "creation",
    label: t("ui.navigation.label.a1fce3b0"),
    icon: "grid",
    description: t("ui.navigation.description.3ceb79c7"),
  },
  {
    id: "tasks",
    label: t("ui.navigation.label.f7c5769b"),
    icon: "task",
    description: t("ui.navigation.description.a174024d"),
  },
];

// 应用级入口：目录数据不属于当前工程，任何路由下都保持在侧栏里。
export const applicationItems: NavigationItem[] = [
  {
    id: "skills",
    label: t("ui.navigation.label.53da139b"),
    icon: "puzzle",
    description: t("ui.navigation.description.c3ec75a7"),
  },
];

export const nodeTypes = [
  { id: "imageGeneration", label: t("ui.taskAdapter.imageGeneration.1f6a9dab"), icon: "image" as const },
  { id: "videoGeneration", label: t("ui.taskAdapter.videoGeneration.19978a8d"), icon: "film" as const },
  { id: "threeDDirector", label: t("ui.navigation.label.1386e28f"), icon: "box" as const },
  { id: "audioGeneration", label: t("ui.taskAdapter.audioGeneration.d371481a"), icon: "waveform" as const },
  { id: "textGeneration", label: t("ui.taskAdapter.textGeneration.9612898b"), icon: "text" as const },
];
