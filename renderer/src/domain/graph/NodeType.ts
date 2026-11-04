export const NodeType = {
  ImageGeneration: 'imageGeneration',
  VideoGeneration: 'videoGeneration',
  AudioGeneration: 'audioGeneration',
  TextGeneration: 'textGeneration',
  Resource: 'resource',
  ThreeDDirector: 'threeDDirector',
  ClipStudio: 'clipStudio',
  CanvasSection: 'canvasSection',
} as const;

export type NodeType = typeof NodeType[keyof typeof NodeType];
export const GENERATION_NODE_TYPES = [NodeType.ImageGeneration, NodeType.VideoGeneration, NodeType.AudioGeneration, NodeType.TextGeneration] as const;
export type GenerationNodeType = typeof GENERATION_NODE_TYPES[number];
export const UTILITY_NODE_TYPES = [NodeType.ThreeDDirector, NodeType.ClipStudio, NodeType.CanvasSection] as const;
export const CANVAS_NODE_TYPES = [...GENERATION_NODE_TYPES, ...UTILITY_NODE_TYPES] as const;
const generationTypes: ReadonlySet<unknown> = new Set(GENERATION_NODE_TYPES);

export function isGenerationNodeType(value: unknown): value is GenerationNodeType {
  return generationTypes.has(value);
}
