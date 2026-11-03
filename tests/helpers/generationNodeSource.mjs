import { readLocalizedSource } from './sourceContract.mjs';

/**
 * 生成节点由外壳、派生状态、媒体体、输入面板和参数面板五个模块组成。
 * 界面契约测试断言的是这条链路的整体行为，因此读取拼接后的源码，
 * 而不是把同一个契约复制到五个文件各自的测试里。
 */
const GENERATION_NODE_MODULES = [
  'GenerationNode.tsx',
  'generationNodeState.ts',
  'GenerationNodePreview.tsx',
  'GenerationNodeImageOverlays.tsx',
  'GenerationNodeComposer.tsx',
  'GenerationSettingsPanel.tsx',
  'generationNodeMedia.ts',
];

export function readGenerationNodeSource() {
  return GENERATION_NODE_MODULES.map((name) => readLocalizedSource(`renderer/src/app/canvas/${name}`)).join('\n');
}
