"use client";

import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { displayName, type Layout, type Photo, type Placement } from "@/lib/api";
import {
  BOARD_H,
  BOARD_W,
  bringToFront,
  cardSize,
  clampPlacement,
  rotateScale,
} from "@/lib/canvas";

interface CanvasBoardProps {
  photos: Photo[];
  layout: Layout;
  onChange: (layout: Layout) => void;
  onOpen: (index: number) => void;
}

interface Point {
  x: number;
  y: number;
}

type Gesture =
  | { kind: "move"; id: string; from: Point; start: Placement; moved: boolean }
  | { kind: "turn"; id: string; from: Point; centre: Point; start: Placement };

const DEFAULT_ZOOM = 0.35;
const TAP_SLOP_PX = 4;
const HANDLE_PX = 28;

// arrows nudge, [ ] rotate, - + scale; shift for bigger steps
export function keyEdit(p: Placement, key: string, big: boolean): Placement | null {
  const step = big ? 50 : 10;
  const turn = big ? 15 : 5;
  const zoom = big ? 1.25 : 1.05;
  const edits: Record<string, Partial<Placement>> = {
    ArrowLeft: { x: p.x - step },
    ArrowRight: { x: p.x + step },
    ArrowUp: { y: p.y - step },
    ArrowDown: { y: p.y + step },
    "[": { r: p.r - turn },
    "]": { r: p.r + turn },
    "-": { s: p.s / zoom },
    "+": { s: p.s * zoom },
    "=": { s: p.s * zoom },
  };
  return key in edits ? clampPlacement({ ...p, ...edits[key] }) : null;
}

function capture(e: ReactPointerEvent) {
  // jsdom has no pointer capture
  (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
}

export function CanvasBoard({ photos, layout, onChange, onOpen }: CanvasBoardProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [selected, setSelected] = useState<string | null>(null);

  // fit the board to the window's width
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width > 0) setZoom(width / BOARD_W);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function update(id: string, p: Placement) {
    onChange({ ...layout, [id]: p });
  }

  function select(id: string) {
    setSelected(id);
    const next = bringToFront(layout, id);
    if (next !== layout) onChange(next);
  }

  function centreOnScreen(p: Placement): Point {
    const rect = board.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    return { x: rect.left + p.x * zoom, y: rect.top + p.y * zoom };
  }

  function onCardDown(e: ReactPointerEvent, id: string) {
    if (e.button !== 0) return;
    capture(e);
    select(id);
    gesture.current = {
      kind: "move",
      id,
      from: { x: e.clientX, y: e.clientY },
      start: layout[id],
      moved: false,
    };
  }

  function onHandleDown(e: ReactPointerEvent, id: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    capture(e);
    gesture.current = {
      kind: "turn",
      id,
      from: { x: e.clientX, y: e.clientY },
      centre: centreOnScreen(layout[id]),
      start: layout[id],
    };
  }

  function onPointerMove(e: ReactPointerEvent) {
    const g = gesture.current;
    if (!g) return;
    const to = { x: e.clientX, y: e.clientY };
    if (g.kind === "turn") {
      update(g.id, { ...layout[g.id], ...rotateScale(g.start, g.centre, g.from, to) });
      return;
    }
    const dx = to.x - g.from.x;
    const dy = to.y - g.from.y;
    if (!g.moved && Math.hypot(dx, dy) < TAP_SLOP_PX) return;
    g.moved = true;
    update(
      g.id,
      clampPlacement({ ...layout[g.id], x: g.start.x + dx / zoom, y: g.start.y + dy / zoom }),
    );
  }

  function onPointerUp() {
    gesture.current = null;
  }

  function onKey(e: KeyboardEvent, id: string, index: number) {
    if (e.key === "Enter") {
      e.preventDefault();
      onOpen(index);
      return;
    }
    const next = keyEdit(layout[id], e.key, e.shiftKey);
    if (!next) return;
    e.preventDefault();
    update(id, next);
  }

  return (
    <div ref={wrap} className="canvas-wrap" style={{ height: BOARD_H * zoom }}>
      <div
        ref={board}
        className="canvas-board"
        role="application"
        aria-label="Canvas: drag photos to move, corner handle to rotate and resize"
        style={{ width: BOARD_W, height: BOARD_H, transform: `scale(${zoom})` }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) setSelected(null);
        }}
      >
        {photos.map((photo, index) => {
          const p = layout[photo.id];
          if (!p) return null;
          const { w, h } = cardSize(photo);
          const isSelected = selected === photo.id;
          // keep the handle the same size on screen whatever the zoom and scale
          const handle = HANDLE_PX / (zoom * p.s);
          return (
            <div
              key={photo.id}
              role="button"
              tabIndex={0}
              aria-label={`Photo ${index + 1} by ${displayName(photo.uploader_name)}`}
              aria-pressed={isSelected}
              data-testid={`card-${photo.id}`}
              data-x={p.x}
              data-y={p.y}
              data-r={p.r}
              data-s={p.s}
              data-z={p.z}
              className={isSelected ? "polaroid selected" : "polaroid"}
              style={{
                left: p.x,
                top: p.y,
                zIndex: p.z,
                transform: `translate(-50%, -50%) rotate(${p.r}deg) scale(${p.s})`,
              }}
              onPointerDown={(e) => onCardDown(e, photo.id)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onDoubleClick={() => onOpen(index)}
              onFocus={() => setSelected(photo.id)}
              onKeyDown={(e) => onKey(e, photo.id, index)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- signed CloudFront URL */}
              <img src={photo.display_url} alt="" width={w} height={h} draggable={false} />
              <span className="polaroid-caption">{displayName(photo.uploader_name)}</span>
              {isSelected && (
                <>
                  <button
                    type="button"
                    className="polaroid-open"
                    aria-label="Open photo"
                    style={{ width: handle, height: handle, fontSize: handle * 0.6 }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onOpen(index)}
                  >
                    &#x2922;
                  </button>
                  <span
                    className="polaroid-handle"
                    aria-hidden
                    style={{ width: handle, height: handle }}
                    onPointerDown={(e) => onHandleDown(e, photo.id)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
