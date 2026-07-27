export const projectWorkspaceItems = [
  { id: 'creation', label: '项目画布', icon: 'grid', description: '编排节点与工作流' },
  { id: 'tasks', label: '项目任务', icon: 'task', description: '当前项目内的执行记录' },
  { id: 'assets', label: '素材库', icon: 'box', description: '角色、场景、风格与分镜参考' },
  { id: 'materials', label: '素材文件', icon: 'image', description: '导入文件与生成结果' },
];

export const assetCategories = [
  { id: 'characters', label: '角色设定', icon: 'user', placeholder: '搜索角色名、性格、外观关键词', aliases: ['actors'] },
  { id: 'scenes', label: '场景设定', icon: 'pin', placeholder: '搜索场景名、地点、氛围关键词', aliases: ['locations'] },
  { id: 'props', label: '道具元素', icon: 'box', placeholder: '搜索道具、物件、关键视觉元素' },
  { id: 'styles', label: '风格参考', icon: 'image', placeholder: '搜索画风、色彩、参考作品关键词', aliases: ['costumes'] },
  { id: 'shots', label: '分镜镜头', icon: 'grid', placeholder: '搜索镜头、构图、动作和剧情节点' },
];

export const nodeTypes = [
  { id: 'imageGeneration', label: '图片生成', icon: 'spark' },
  { id: 'videoGeneration', label: '视频生成', icon: 'spark' },
  { id: 'threeDDirector', label: '3D导演台', icon: 'box' },
  { id: 'audioGeneration', label: '音频生成', icon: 'spark' },
  { id: 'textGeneration', label: '文本生成', icon: 'spark' },
  { id: 'board', label: '画板', icon: 'grid' },
  { id: 'note', label: '便签', icon: 'chat' },
];
