import type { AgentAction, AgentProject } from './agentTypes';

type FactoryAction = AgentAction & Record<string, any>;

const DEFAULT_WIDTH = 370;
const DEFAULT_HEIGHT = 270;
const COLUMN_GAP = 72;
const ROW_GAP = 32;

function nodeRect(node: Record<string, any>) {
  return {
    x: Number(node.x) || 0,
    y: Number(node.y) || 0,
    width: Number(node.width) || (node.type === 'note' || node.type === 'resource' ? 240 : DEFAULT_WIDTH),
    height: Number(node.height) || (node.type === 'note' || node.type === 'resource' ? 150 : DEFAULT_HEIGHT),
  };
}

function overlaps(first: ReturnType<typeof nodeRect>, second: ReturnType<typeof nodeRect>): boolean {
  return first.x < second.x + second.width + ROW_GAP
    && first.x + first.width + ROW_GAP > second.x
    && first.y < second.y + second.height + ROW_GAP
    && first.y + first.height + ROW_GAP > second.y;
}

export function numberFromAgentAction(action: FactoryAction, key: string, fallback: number): number {
  const position = action.position as Record<string, unknown> | undefined;
  const parsed = Number(position?.[key] ?? action[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function sizeFromAgentAction(action: FactoryAction, key: string, fallback: number): number {
  const parsed = Number(action.size?.[key] ?? action[key]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function defaultAgentNodePosition(project: AgentProject, action: FactoryAction = { type: '' }) {
  const explicitX = Number(action.position?.x ?? action.x);
  const explicitY = Number(action.position?.y ?? action.y);
  if (Number.isFinite(explicitX) || Number.isFinite(explicitY)) {
    return {
      x: Number.isFinite(explicitX) ? explicitX : 80,
      y: Number.isFinite(explicitY) ? explicitY : 80,
    };
  }

  const nodes = (project.nodes || []) as Array<Record<string, any>>;
  const obstacles = nodes.map(nodeRect);
  const anchorIds = new Set((action.anchorNodeIds || []).map(String));
  const anchors = nodes.filter((node) => anchorIds.has(String(node.id)));
  const width = sizeFromAgentAction(action, 'width', action.type === 'create_note_node' ? 240 : DEFAULT_WIDTH);
  const height = sizeFromAgentAction(action, 'height', action.type === 'create_note_node' ? 150 : DEFAULT_HEIGHT);

  const right = obstacles.length
    ? Math.max(...obstacles.map((rect) => rect.x + rect.width)) + COLUMN_GAP
    : 80;
  const anchor = anchors[0] ? nodeRect(anchors[0]) : null;
  const base = anchor
    ? { x: anchor.x + anchor.width + COLUMN_GAP, y: anchor.y }
    : { x: right, y: obstacles.length ? Math.min(...obstacles.map((rect) => rect.y)) : 80 };

  // 优先落在引用节点右侧；冲突时向下扫描，再换到画布最右侧的新列。
  for (let column = 0; column < 8; column += 1) {
    for (let row = 0; row < Math.max(8, nodes.length + 1); row += 1) {
      const candidate = {
        x: (column === 0 ? base.x : right + (column - 1) * (width + COLUMN_GAP)),
        y: base.y + row * (height + ROW_GAP),
        width,
        height,
      };
      if (obstacles.every((rect) => !overlaps(candidate, rect))) {
        return { x: Math.round(candidate.x), y: Math.round(candidate.y) };
      }
    }
  }

  const index = (project.nodes || []).length;
  return {
    x: 80 + (index % 4) * 440,
    y: 80 + Math.floor(index / 4) * 320,
  };
}
