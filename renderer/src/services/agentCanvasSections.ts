import { store, touchProject } from '@/store/projectStore';
import { recordCanvasTransactionHistory } from '@/store/canvasHistoryStore';
import { captureCanvasTransaction, filterChangedCanvasTransaction } from '@/utils/canvasTransaction';
import { uid } from '@/utils/format';
import { t } from '@/i18n';
import type { AgentNode, JsonObject } from './agentTypes';
import type { SectionNode } from '@/domain/graph/CanvasSections';
import {
  arrangeCanvasSection, canvasSectionBounds, canvasSectionMembers,
  fitCanvasSectionsToMembers, moveCanvasSectionNodes, retainCanvasSectionMembership,
} from '@/domain/graph/CanvasSections';

export interface AgentSectionInput extends JsonObject {
  operation: 'create' | 'update' | 'add_nodes' | 'remove_nodes' | 'arrange' | 'delete';
  sectionId?: string;
  nodeIds?: string[];
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  autoLayout?: boolean;
}

/** Called inside the canvas executor queue; all references are validated before writing. */
export function editAgentCanvasSection(input: AgentSectionInput, resolveId: (id: string) => string | null) {
  const nodes = store.project.nodes as (AgentNode & SectionNode)[];
  const failure = (error: string) => ({ success: false, error });
  if (!['create', 'update', 'add_nodes', 'remove_nodes', 'arrange', 'delete'].includes(input.operation)) {
    return failure('Unknown section operation. Use create, update, add_nodes, remove_nodes, arrange or delete.');
  }
  const sectionId = input.operation === 'create' ? uid() : resolveId(input.sectionId || '');
  let section = nodes.find(node => node.id === sectionId && node.type === 'canvasSection' && !node.archived);
  if (input.operation !== 'create' && !section) return failure('Section not found. Read canvas_list_nodes and supply a live canvasSection ID.');
  const members = [];
  for (const reference of new Set(input.nodeIds || [])) {
    const member = nodes.find(node => node.id === resolveId(reference) && !node.archived);
    if (!member || member.type === 'canvasSection') return failure(`Invalid member ${reference}: supply an existing non-section node ID.`);
    members.push(member);
  }
  if (['add_nodes', 'remove_nodes'].includes(input.operation) && !members.length) return failure('nodeIds must contain the nodes to add or remove.');
  if (input.operation === 'remove_nodes' && members.some(node => !canvasSectionMembers(section!, nodes).some(item => item.id === node.id))) {
    return failure('Some nodes do not belong to this section. Read the section membership before removing nodes.');
  }
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (input[key] !== undefined && (!Number.isFinite(input[key]) || (key === 'width' && input[key]! < 240) || (key === 'height' && input[key]! < 160))) {
      return failure(`${key} must be finite; minimum width is 240 and minimum height is 160.`);
    }
  }
  const sectionEdgeIds = store.project.edges.filter((edge: { source: string; target: string }) => edge.source === sectionId || edge.target === sectionId).map((edge: { id: string }) => edge.id);
  const before = captureCanvasTransaction(store.project, [...nodes.map(node => node.id), ...(input.operation === 'create' ? [sectionId!] : [])], sectionEdgeIds, store);
  retainCanvasSectionMembership(nodes);
  if (input.operation === 'create') {
    const position = { x: input.x ?? 80, y: input.y ?? 80 };
    section = {
      id: sectionId!, type: 'canvasSection', title: input.title?.trim() || t('canvas.section.default'),
      ...canvasSectionBounds(members, position), createdAt: new Date().toISOString(), canvasSectionAutoLayout: input.autoLayout ?? true,
    };
    nodes.push(section);
    for (const member of members) member.canvasSectionId = section.id;
  }
  const target = section!;
  if (input.operation === 'create' || input.operation === 'update') {
    if (input.title !== undefined) target.title = input.title.trim() || t('canvas.section.default');
    if (input.autoLayout !== undefined) target.canvasSectionAutoLayout = input.autoLayout;
    if (input.x !== undefined || input.y !== undefined) moveCanvasSectionNodes(nodes, [{ id: target.id, x: input.x ?? (Number(target.x) || 0), y: input.y ?? (Number(target.y) || 0) }]);
    if (input.width !== undefined) target.canvasWidth = input.width;
    if (input.height !== undefined) target.canvasHeight = input.height;
  }
  if (input.operation === 'add_nodes') for (const member of members) member.canvasSectionId = target.id;
  if (input.operation === 'remove_nodes') for (const member of members) member.canvasSectionId = null;
  if (input.operation === 'delete') {
    for (const member of canvasSectionMembers(target, nodes)) member.canvasSectionId = null;
    store.project.nodes = nodes.filter(node => node.id !== target.id);
    store.project.edges = store.project.edges.filter((edge: { id: string }) => !sectionEdgeIds.includes(edge.id));
    store.selectedNodeIds = store.selectedNodeIds.filter(id => id !== target.id);
    if (store.selectedNodeId === target.id) store.selectedNodeId = store.selectedNodeIds[0] || null;
  } else {
    if (input.operation === 'arrange' || target.canvasSectionAutoLayout) arrangeCanvasSection(target, nodes, { fitHeight: input.operation === 'arrange' });
    fitCanvasSectionsToMembers(nodes);
  }
  const changes = filterChangedCanvasTransaction(store.project, before);
  if (changes.nodes.length) {
    recordCanvasTransactionHistory(t('tool.title.canvas_manage_section'), changes);
    touchProject();
  }
  return {
    success: true, sectionId: target.id, deleted: input.operation === 'delete',
    nodeIds: input.operation === 'delete' ? [] : [target.id],
    changedNodeIds: changes.nodes.map(change => change.id),
    section: input.operation === 'delete' ? null : {
      id: target.id, title: target.title, x: target.x, y: target.y,
      width: target.canvasWidth, height: target.canvasHeight, autoLayout: target.canvasSectionAutoLayout,
      nodeIds: canvasSectionMembers(target, store.project.nodes).map(node => node.id),
    },
  };
}
