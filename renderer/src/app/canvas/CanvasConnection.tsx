import { memo, useLayoutEffect, useState } from 'react';
import { BaseEdge, Position, useStore, useStoreApi, type ConnectionLineComponentProps, type EdgeProps } from '@xyflow/react';

function connectionPath(
  sourceX: number, sourceY: number, targetX: number, targetY: number,
  sourcePosition: Position, targetPosition: Position,
) {
  const distance = Math.max(Math.abs(targetX - sourceX) / 2, 50);
  const sourceControl = sourceX + (sourcePosition === Position.Left ? -distance : distance);
  const targetControl = targetX + (targetPosition === Position.Left ? -distance : distance);
  return `M ${sourceX} ${sourceY} C ${sourceControl} ${sourceY}, ${targetControl} ${targetY}, ${targetX} ${targetY}`;
}

function BatchCellConnection(props: EdgeProps) {
  const { target, targetX, targetY } = props;
  const { getState } = useStoreApi();
  const height = useStore(state => state.nodeLookup.get(target)?.measured.height);
  const width = useStore(state => state.nodeLookup.get(target)?.measured.width);
  const [endpoint, setEndpoint] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const state = getState();
    const position = state.nodeLookup.get(target)?.internals.positionAbsolute;
    const node = state.domNode?.querySelector(`.react-flow__node[data-id="${CSS.escape(target)}"]`);
    const scroll = node?.querySelector('.batch-table-scroll');
    const header = scroll?.querySelector('.batch-table-head-cell');
    const zoom = state.transform[2];
    if (!position || !node || !scroll || !header || !(zoom > 0)) {
      setEndpoint(null);
      return;
    }
    const nodeBox = node.getBoundingClientRect();
    const viewport = scroll.getBoundingClientRect();
    const left = position.x + (viewport.left - nodeBox.left) / zoom;
    const right = position.x + (viewport.right - nodeBox.left) / zoom;
    const top = position.y + (header.getBoundingClientRect().bottom - nodeBox.top) / zoom;
    const bottom = position.y + (viewport.bottom - nodeBox.top) / zoom;
    // Show where the reference exits the scroll area while its cell is offscreen.
    const x = Math.max(left, Math.min(right, targetX));
    const y = Math.max(top, Math.min(bottom, targetY));
    setEndpoint(x !== targetX || y !== targetY ? { x, y } : null);
  }, [getState, target, targetX, targetY, width, height]);

  return <ConnectionStroke {...props} targetX={endpoint?.x ?? targetX} targetY={endpoint?.y ?? targetY} interactionWidth={8} />;
}

function ConnectionStroke({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, interactionWidth = 16,
}: EdgeProps & { interactionWidth?: number }) {
  const path = connectionPath(sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition);
  return (
    <>
      <BaseEdge id={id} path={path} interactionWidth={interactionWidth} />
      <g className="canvas-connection-decoration" aria-hidden="true">
        <circle cx={sourceX} cy={sourceY} r={2.5} />
        <circle cx={targetX} cy={targetY} r={2.5} />
        <path className="canvas-connection-beam canvas-connection-beam-tail" d={path} pathLength={300} />
        <path className="canvas-connection-beam" d={path} pathLength={300} />
      </g>
    </>
  );
}

const CanvasConnection = memo(function CanvasConnection(props: EdgeProps) {
  return props.data?.batchCell ? <BatchCellConnection {...props} /> : <ConnectionStroke {...props} />;
});

export const canvasEdgeTypes = { connection: CanvasConnection };

export function CanvasConnectionDraft({
  fromX, fromY, toX, toY, fromPosition, toPosition,
}: ConnectionLineComponentProps) {
  return <path
    className="react-flow__connection-path"
    d={connectionPath(fromX, fromY, toX, toY, fromPosition, toPosition)}
  />;
}
