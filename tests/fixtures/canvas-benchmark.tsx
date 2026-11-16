import React, { Profiler, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { useEditorMount } from '../../renderer/src/app/editor/openReel/useEditorMount';
import { App, Button, ConfigProvider, Modal } from 'antd';
import { WorkflowCanvas, type WorkflowNodeData, type WorkflowNodeActions, type WorkflowCanvasController } from '../../renderer/src/app/canvas/WorkflowCanvas';
import { GenerationNode } from '../../renderer/src/app/canvas/GenerationNode';
import { ProjectSnapshotCanvas } from '../../renderer/src/app/components/ProjectSnapshotCanvas';
import { canvasInputIndex } from '../../renderer/src/app/canvas/canvasInputIndex';
import '../../renderer/styles/tokens.css';
import '../../renderer/styles/canvas.css';
import '../../renderer/styles/creation-canvas.css';
import '../../renderer/src/app/editor/OpenReelWorkspace.css';

const count = Math.min(5000, Math.max(3, Number(new URLSearchParams(location.search).get('nodes')) || 200));
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="350" height="240"><rect width="350" height="240" fill="#506c85"/><circle cx="180" cy="110" r="70" fill="#dbbe78"/></svg>')}`;
const initial: WorkflowNodeData[] = Array.from({ length: count }, (_, i) => ({ id: `n${i}`, type: i === 3 ? 'clipStudio' : i % 3 === 0 ? 'textGeneration' : i % 3 === 1 ? 'imageGeneration' : 'videoGeneration',
  title: `Shot ${i}`, prompt: `Scene ${i}`, textContent: `Scene ${i}\n${'A quiet landscape. '.repeat(30)}`, status: 'idle',
  x: i % 20 * 420, y: Math.floor(i / 20) * 580 + (i % 3) * 30, selected: i < 3,
  generatedOutputs: i % 3 === 1 ? [{ id: `out${i}`, resourceType: 'image', url: image, selected: true }] : [],
}));
const edges = initial.slice(1).map((node, i) => ({ id: `e${i}`, source: initial[i].id, target: node.id }));
// Exercise the real detached timeline mount without loading a media engine.
function ClipMountProbe({ node }) {
  const { mount } = useEditorMount(document.body, node.id, false, false);
  return <div data-clip-node-id={node.id} style={{ width: '100%', height: '100%' }}>
    {createPortal(<section data-clip-probe style={{ background: 'var(--surface)' }}>Timeline mount</section>, mount)}
  </div>;
}
const renderers = { textGeneration: GenerationNode, imageGeneration: GenerationNode, videoGeneration: GenerationNode, clipStudio: ClipMountProbe };
const commits: number[] = [];
let getNodes = () => initial;
let moveCommits = 0;
const frame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));

async function measure() {
  commits.length = 0;
  const intervals: number[] = [];
  let previous = await frame();
  for (let i = 0; i < 60; i++) {
    const pane = document.querySelector('.react-flow__pane')!;
    pane.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: i < 30 ? 8 : -8, clientX: 600, clientY: 400 }));
    const next = await frame(); intervals.push(next - previous); previous = next;
  }
  await new Promise(resolve => setTimeout(resolve, 300));
  const nodes = getNodes();
  const start = performance.now();
  for (let i = 0; i < 60; i++) canvasInputIndex([...nodes], edges, 'Node');
  const coldMs = performance.now() - start;
  canvasInputIndex(nodes, edges, 'Node');
  const warmStart = performance.now();
  for (let i = 0; i < 60; i++) canvasInputIndex(nodes, edges, 'Node');
  const cachedMs = performance.now() - warmStart;
  intervals.sort((a, b) => a - b);
  return { nodes: nodes.length, mounted: document.querySelectorAll('.react-workflow-canvas .react-flow__node').length,
    frameP50Ms: intervals[30], frameP95Ms: intervals[57], reactCommits: commits.length,
    reactTotalMs: commits.reduce((a, b) => a + b, 0), graphCold60Ms: coldMs, graphCached60Ms: cachedMs,
    heapBytes: (performance as any).memory?.usedJSHeapSize ?? null, moveCommits };
}

async function stability() {
  for (let i = 0; i < 6; i++) {
    document.querySelector('.react-flow__pane')!.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -18, clientX: 600, clientY: 400 }));
    await frame();
  }
  // Drain the final wheel frame and React Flow geometry update, then observe
  // well past the former 140ms commit boundary for any late size reset.
  await frame(); await frame(); await frame();
  const samples = [];
  for (let i = 0; i < 24; i++) {
    samples.push({
      widths: ['n0', 'n1', 'n2', 'n3'].map(id => document.querySelector(`[data-id="${id}"]`)?.getBoundingClientRect().width || 0),
      clipAnchor: document.querySelector('[data-clip-node-id="n3"]')?.getBoundingClientRect().width || 0,
      clipEditor: document.querySelector('[data-clip-probe]')?.getBoundingClientRect().width || 0,
    });
    await frame();
  }
  return { samples, maximumLateWidthChange: Math.max(...samples.flatMap(sample => sample.widths.map((width, i) => Math.abs(width - samples[0].widths[i])))),
    maximumClipMismatch: Math.max(...samples.map(sample => Math.abs(sample.clipAnchor - sample.clipEditor))) };
}

function Benchmark() {
  const [nodes, setNodes] = useState(initial);
  const [history, setHistory] = useState<WorkflowNodeData[][]>([]);
  const [preview, setPreview] = useState(false);
  const [result, setResult] = useState('');
  getNodes = () => nodes;
  const controller = useMemo(() => ({
    moveNodes(positions) { moveCommits++; setNodes(current => { setHistory(stack => [...stack, current]); return current.map(node => { const position = positions.find(item => item.id === node.id); return position ? { ...node, ...position } : node; }); }); },
    selectNodes(ids) { setNodes(current => current.map(node => ({ ...node, selected: ids.includes(node.id) }))); },
    selectEdge() {}, connect() {}, saveViewport() {}, createNodeAt() {}, createArtifactNodeAt() {}, deleteSelection() {},
  }) as WorkflowCanvasController, []);
  const actions = useMemo(() => new Proxy({ select: (id: string) => controller.selectNodes([id]), listReferenceCandidates: () => [] }, { get: (target, key) => target[key as keyof typeof target] || (() => {}) }) as unknown as WorkflowNodeActions, [controller]);
  return <>
    <div style={{ height: 54, display: 'flex', gap: 12, alignItems: 'center' }}>
      <Button onClick={async () => setResult(JSON.stringify(await measure()))}>Measure zoom</Button>
      <Button disabled={!history.length} onClick={() => { setNodes(history.at(-1)!); setHistory(history.slice(0, -1)); }}>Undo</Button>
      <Button onClick={() => setPreview(true)}>Preview snapshot</Button>
      <span>{count} nodes</span>
    </div>
    <div style={{ height: 'calc(100vh - 120px)' }}><Profiler id="canvas" onRender={(_id, _phase, duration) => commits.push(duration)}>
      <WorkflowCanvas nodes={nodes} edges={edges} viewport={{ x: 30, y: 40, zoom: 0.65 }} renderers={renderers} nodeActions={actions} controller={controller} />
    </Profiler></div>
    <output style={{ fontSize: 12 }}>{result}</output>
    <Modal open={preview} onCancel={() => setPreview(false)} footer={null} width={1000} destroyOnHidden>
      {preview && <ProjectSnapshotCanvas payload={{ nodes: initial, edges }} />}
    </Modal>
  </>;
}
(window as any).canvasBenchmark = { measure, stability, positions: () => getNodes().slice(0, 3).map(({ id, x, y }) => ({ id, x, y })) };
createRoot(document.getElementById('root')!).render(<ConfigProvider><App><Benchmark /></App></ConfigProvider>);
