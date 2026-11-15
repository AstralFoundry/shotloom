import { canvasNodeDimensions } from './CanvasNodeDimensions.ts';

export interface SectionNode {
  id: string;
  type: string;
  x?: unknown;
  y?: unknown;
  canvasWidth?: unknown;
  canvasHeight?: unknown;
  archived?: boolean;
  canvasSectionId?: string | null;
  canvasSectionAutoLayout?: boolean;
}

/** Legacy projects infer ownership once; saved membership survives size changes. */
function containingSection(node: SectionNode, nodes: SectionNode[], centerOnly = false): SectionNode | undefined {
  const size = canvasNodeDimensions(node);
  const x = Number(node.x) || 0, y = Number(node.y) || 0;
  return nodes.filter(section => {
    if (section.type !== 'canvasSection' || section.archived) return false;
    const bounds = canvasNodeDimensions(section);
    const left = Number(section.x) || 0, top = Number(section.y) || 0;
    return centerOnly
      ? x + size.width / 2 >= left && y + size.height / 2 >= top && x + size.width / 2 <= left + bounds.width && y + size.height / 2 <= top + bounds.height
      : x >= left && y >= top && x + size.width <= left + bounds.width && y + size.height <= top + bounds.height;
  }).sort((a, b) => {
    const sa = canvasNodeDimensions(a), sb = canvasNodeDimensions(b);
    return sa.width * sa.height - sb.width * sb.height || a.id.localeCompare(b.id);
  })[0];
}

/** Shared by drag feedback and the committed drop, in canonical canvas coordinates. */
export function canvasSectionDropTarget(node: SectionNode, nodes: SectionNode[]): SectionNode | undefined {
  if (node.archived || node.type === 'canvasSection') return undefined;
  return containingSection(node, nodes, true);
}

export function canvasSectionMembers<T extends SectionNode>(section: SectionNode, nodes: T[]): T[] {
  return nodes.filter(node => !node.archived && node.type !== 'canvasSection' && (
    node.canvasSectionId === undefined ? containingSection(node, nodes)?.id === section.id : node.canvasSectionId === section.id
  ));
}

export function retainCanvasSectionMembership(nodes: SectionNode[]): void {
  const sections = new Set(nodes.filter(node => node.type === 'canvasSection').map(node => node.id));
  for (const node of nodes) {
    if (node.type === 'canvasSection') { delete node.canvasSectionId; continue; }
    if (node.canvasSectionId === undefined) node.canvasSectionId = containingSection(node, nodes)?.id ?? null;
    else if (node.canvasSectionId && !sections.has(node.canvasSectionId)) node.canvasSectionId = null;
  }
}

/** Row layout follows the user's frame width and stable project order, for every node type. */
export function arrangeCanvasSection(section: SectionNode, nodes: SectionNode[], { fitHeight = true }: { fitHeight?: boolean } = {}): void {
  const members = canvasSectionMembers(section, nodes);
  if (!members.length) return;
  const left = Number(section.x) || 0, top = Number(section.y) || 0;
  const width = Math.max(canvasNodeDimensions(section).width, ...members.map(node => canvasNodeDimensions(node).width + 64));
  let x = left + 32, y = top + 56, rowHeight = 0;
  for (const member of members) {
    const size = canvasNodeDimensions(member);
    if (x > left + 32 && x + size.width > left + width - 32) {
      x = left + 32;
      y += rowHeight + 32;
      rowHeight = 0;
    }
    Object.assign(member, { x, y });
    x += size.width + 32;
    rowHeight = Math.max(rowHeight, size.height);
  }
  Object.assign(section, { canvasWidth: width, canvasHeight: Math.max(fitHeight ? 160 : canvasNodeDimensions(section).height, y + rowHeight + 32 - top) });
}

/** Apply only explicitly owned nodes during persistence: a newly created node
 * may still be waiting for its final canvas position at this point. */
export function arrangeAutomaticCanvasSections(nodes: SectionNode[]): void {
  for (const section of nodes) {
    if (section.type !== 'canvasSection' || section.archived || !section.canvasSectionAutoLayout) continue;
    arrangeCanvasSection(section, nodes.filter(node => node.canvasSectionId === section.id), { fitHeight: false });
  }
}

/** Resizing a frame or its content must not silently lose an existing member. */
export function fitCanvasSectionsToMembers(nodes: SectionNode[]): void {
  for (const section of nodes.filter(node => node.type === 'canvasSection' && !node.archived)) {
    if (section.canvasSectionAutoLayout) { arrangeCanvasSection(section, nodes, { fitHeight: false }); continue; }
    const members = canvasSectionMembers(section, nodes);
    if (!members.length) continue;
    const size = canvasNodeDimensions(section);
    const bounds = canvasSectionBounds(members, { x: 0, y: 0 });
    const left = Math.min(Number(section.x) || 0, bounds.x);
    const top = Math.min(Number(section.y) || 0, bounds.y);
    const right = Math.max((Number(section.x) || 0) + size.width, bounds.x + bounds.canvasWidth);
    const bottom = Math.max((Number(section.y) || 0) + size.height, bounds.y + bounds.canvasHeight);
    Object.assign(section, { x: left, y: top, canvasWidth: right - left, canvasHeight: bottom - top });
  }
}

/** Absolute coordinates remain canonical; sections carry members in one transaction. */
export function moveCanvasSectionNodes(nodes: SectionNode[], positions: { id: string; x: number; y: number }[]): void {
  retainCanvasSectionMembership(nodes);
  const moved = new Map(positions.map(position => [position.id, position]));
  const movedSections = nodes.filter(node => node.type === 'canvasSection' && moved.has(node.id));
  for (const section of movedSections) {
    const target = moved.get(section.id)!;
    for (const member of canvasSectionMembers(section, nodes)) {
      if (!moved.has(member.id)) moved.set(member.id, { id: member.id,
        x: (Number(member.x) || 0) + target.x - (Number(section.x) || 0),
        y: (Number(member.y) || 0) + target.y - (Number(section.y) || 0) });
    }
  }
  for (const node of nodes) {
    const position = moved.get(node.id);
    if (position) Object.assign(node, { x: position.x, y: position.y });
  }
  for (const node of nodes) {
    if (!moved.has(node.id) || node.type === 'canvasSection' || node.archived) continue;
    if (movedSections.some(section => section.id === node.canvasSectionId)) continue;
    node.canvasSectionId = canvasSectionDropTarget(node, nodes)?.id ?? null;
  }
  fitCanvasSectionsToMembers(nodes);
}

export function canvasSectionBounds(nodes: SectionNode[], fallback: { x: number; y: number }) {
  const members = nodes.filter(node => !node.archived && node.type !== 'canvasSection');
  if (!members.length) return { ...fallback, canvasWidth: 800, canvasHeight: 560 };
  const left = Math.min(...members.map(node => Number(node.x) || 0));
  const top = Math.min(...members.map(node => Number(node.y) || 0));
  const right = Math.max(...members.map(node => (Number(node.x) || 0) + canvasNodeDimensions(node).width));
  const bottom = Math.max(...members.map(node => (Number(node.y) || 0) + canvasNodeDimensions(node).height));
  return { x: left - 32, y: top - 56, canvasWidth: Math.max(240, right - left + 64), canvasHeight: Math.max(160, bottom - top + 88) };
}
