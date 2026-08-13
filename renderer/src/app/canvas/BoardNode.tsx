import { memo, type PointerEvent, useEffect, useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import {
  boardToDataUrl,
  cropFromPoints,
  ensureBoardData,
  renderBoardToCanvas,
} from "../../utils/boardRender.js";
import { toRaw } from "../../store/domainReactivity.js";
import { IconSymbol } from "../components/IconSymbol";
import type { WorkflowNodeRenderer } from "./WorkflowCanvas";

type Point = { x: number; y: number };
export const BoardNode: WorkflowNodeRenderer = memo(({ node, selected, actions }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<"draw" | "text" | "crop">("draw");
  const [color, setColor] = useState("#1f2937");
  const [width, setWidth] = useState(3);
  const [text, setText] = useState("");
  const drawing = useRef(false);
  const stroke = useRef<Record<string, unknown> | null>(null);
  const cropStart = useRef<Point | null>(null);
  const boardRef = useRef(
    ensureBoardData({
      boardData: node.boardData ? structuredClone(toRaw(node.boardData)) : undefined,
    }),
  );
  useEffect(() => {
    if (drawing.current || cropStart.current) return;
    boardRef.current = ensureBoardData({
      boardData: node.boardData ? structuredClone(toRaw(node.boardData)) : undefined,
    });
    if (canvas.current) renderBoardToCanvas(canvas.current, boardRef.current);
  }, [node.boardData]);
  function point(event: PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.round(((event.clientX - rect.left) / rect.width) * 640),
      y: Math.round(((event.clientY - rect.top) / rect.height) * 360),
    };
  }
  function redraw() {
    if (canvas.current) renderBoardToCanvas(canvas.current, boardRef.current);
  }
  function persist() {
    actions.update(node.id, {
      boardData: structuredClone(boardRef.current),
      updatedAt: new Date().toISOString(),
    });
    redraw();
  }
  function addText(at: Point) {
    const value = text.trim();
    if (!value) return;
    boardRef.current.texts.push({
      id: `${Date.now()}-${boardRef.current.texts.length + 1}`,
      text: value,
      x: at.x,
      y: at.y,
      color,
      fontSize: Math.max(12, Math.round(width * 4 + 12)),
    });
    persist();
  }
  function down(event: PointerEvent<HTMLCanvasElement>) {
    event.stopPropagation();
    event.preventDefault();
    const at = point(event);
    if (tool === "text") return addText(at);
    if (tool === "crop") {
      cropStart.current = at;
      boardRef.current.crop = { ...at, width: 1, height: 1 };
      redraw();
      return;
    }
    drawing.current = true;
    const next = { color, width, points: [at] };
    stroke.current = next;
    boardRef.current.strokes.push(next);
    redraw();
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (cropStart.current) {
      const crop = cropFromPoints(cropStart.current, point(event));
      if (crop) boardRef.current.crop = crop;
      redraw();
      return;
    }
    if (!drawing.current || !stroke.current) return;
    (stroke.current.points as Point[]).push(point(event));
    redraw();
  }
  function end() {
    if (cropStart.current) {
      cropStart.current = null;
      persist();
      return;
    }
    if (drawing.current) {
      drawing.current = false;
      stroke.current = null;
      persist();
    }
  }
  return (
    <div
      className={`board-node${selected ? " selected" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        actions.select(node.id);
      }}
    >
      <Handle
        id="port-left"
        className="board-port board-port-in"
        type="source"
        position={Position.Left}
      />
      <Handle
        id="port-right"
        className="board-port board-port-out"
        type="source"
        position={Position.Right}
      />
      <div className="board-head">
        <IconSymbol name="grid" />
        <input
          className="nodrag"
          value={String(node.title || "画板")}
          placeholder="画板"
          onChange={(e) => actions.update(node.id, { title: e.target.value })}
          onClick={(e) => e.stopPropagation()}
        />
        <button
          title="导出图片"
          onClick={() => actions.exportBoard(node.id, boardToDataUrl(boardRef.current))}
        >
          <IconSymbol name="download" />
        </button>
        <button title="添加图片" onClick={() => actions.addBoardImage(node.id)}>
          <IconSymbol name="image" />
        </button>
        <button
          title="清空画板"
          onClick={() => {
            boardRef.current.strokes = [];
            boardRef.current.texts = [];
            boardRef.current.images = [];
            delete boardRef.current.crop;
            persist();
          }}
        >
          <IconSymbol name="x" />
        </button>
        {selected && (
          <button title="Delete" onClick={() => actions.delete(node.id)}>
            <IconSymbol name="trash" />
          </button>
        )}
      </div>
      <canvas
        ref={canvas}
        className="nodrag"
        width="640"
        height="360"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <div
        className="board-tools nodrag"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="board-tool-tabs">
          <button
            className={tool === "draw" ? "active" : ""}
            title="画笔"
            onClick={() => setTool("draw")}
          >
            <IconSymbol name="cursor" />
          </button>
          <button
            className={tool === "text" ? "active" : ""}
            title="文字"
            onClick={() => setTool("text")}
          >
            T
          </button>
          <button
            className={tool === "crop" ? "active" : ""}
            title="裁剪"
            onClick={() => setTool("crop")}
          >
            <IconSymbol name="crop" />
          </button>
        </div>
        <input
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="board-color"
          type="color"
          title="颜色"
        />
        <input
          value={width}
          onChange={(e) => setWidth(Number(e.target.value))}
          className="board-width"
          type="range"
          min="1"
          max="12"
          title="笔宽"
        />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="board-text-input"
          placeholder="文字"
          disabled={tool !== "text"}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addText({ x: 320, y: 180 });
            }
          }}
        />
      </div>
      <textarea
        className="nodrag nowheel"
        value={String(node.boardText || node.content || "")}
        placeholder="画板备注"
        rows={2}
        onChange={(e) =>
          actions.update(node.id, {
            boardText: e.target.value,
            content: e.target.value,
            updatedAt: new Date().toISOString(),
          })
        }
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </div>
  );
});
