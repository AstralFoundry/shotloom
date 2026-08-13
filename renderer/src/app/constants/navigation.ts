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
    label: "项目画布",
    icon: "grid",
    description: "编排节点与工作流",
  },
  {
    id: "tasks",
    label: "项目任务",
    icon: "task",
    description: "当前项目内的执行记录",
  },
];

export const assetCategories: Array<
  { id: string; label: string; icon: IconName; aliases: string[] }
> = [
  {
    id: "characters",
    label: "角色设定",
    icon: "user" as const,
    aliases: ["actors"],
  },
  {
    id: "scenes",
    label: "场景设定",
    icon: "pin" as const,
    aliases: ["locations"],
  },
  { id: "props", label: "道具元素", icon: "box" as const, aliases: [] },
  {
    id: "styles",
    label: "风格参考",
    icon: "image" as const,
    aliases: ["costumes"],
  },
  { id: "shots", label: "分镜镜头", icon: "grid" as const, aliases: [] },
];

export const nodeTypes = [
  { id: "imageGeneration", label: "图片生成", icon: "image" as const },
  { id: "videoGeneration", label: "视频生成", icon: "film" as const },
  { id: "threeDDirector", label: "3D导演台", icon: "box" as const },
  { id: "audioGeneration", label: "音频生成", icon: "waveform" as const },
  { id: "textGeneration", label: "文本生成", icon: "text" as const },
  { id: "board", label: "画板", icon: "grid" as const },
  { id: "note", label: "便签", icon: "chat" as const },
];
