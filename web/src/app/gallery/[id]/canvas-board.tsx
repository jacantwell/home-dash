"use client";

import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { Button } from "@/components/xp";
import { displayName, type Layout, type Photo, type Placement } from "@/lib/api";
import { clampPlacement, faceYaw, keyEdit } from "@/lib/space";

import type { SpaceScene } from "./space-scene";

interface CanvasBoardProps {
  photos: Photo[];
  layout: Layout;
  onChange: (layout: Layout) => void;
  onOpen: (index: number) => void;
}

const HINT =
  "Drag to look around, right-drag to pan, scroll to zoom. Drag a photo to move it, " +
  "shift-drag to push it back or pull it forward, alt-drag to turn and resize it. " +
  "Double-click to open.";

export function CanvasBoard({ photos, layout, onChange, onOpen }: CanvasBoardProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<SpaceScene | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  // the scene is made once; its callbacks read the newest props through this
  const latest = useRef({ photos, layout, onChange, onOpen });
  useEffect(() => {
    latest.current = { photos, layout, onChange, onOpen };
  });

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let live = true;
    let made: SpaceScene | null = null;
    import("./space-scene")
      .then(({ SpaceScene }) => {
        if (!live) return;
        made = new SpaceScene(el, {
          onSelect: setSelected,
          onMove: (id, p) => latest.current.onChange({ ...latest.current.layout, [id]: p }),
          onOpen: (id) => {
            const index = latest.current.photos.findIndex((p) => p.id === id);
            if (index >= 0) latest.current.onOpen(index);
          },
        });
        setScene(made);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
      made?.dispose();
    };
  }, []);

  useEffect(() => {
    scene?.sync(photos, layout, selected);
  }, [scene, photos, layout, selected]);

  const current = selected ? layout[selected] : undefined;

  function edit(id: string, p: Placement) {
    onChange({ ...layout, [id]: clampPlacement(p) });
  }

  function onKey(e: KeyboardEvent, id: string, index: number) {
    if (e.key === "Enter") {
      e.preventDefault();
      onOpen(index);
      return;
    }
    const next = keyEdit(layout[id], e.key, e.shiftKey, scene?.viewYaw() ?? 0);
    if (!next) return;
    e.preventDefault();
    edit(id, next);
  }

  return (
    <div ref={wrap} className="canvas-wrap" role="application" aria-label="3D canvas">
      {failed && (
        <p className="space-fallback">
          This browser can&apos;t draw the 3D canvas. Use Thumbnails, or move photos with the
          keyboard: Tab to a photo, then arrows, Page Up/Down, [ ] , . and - +.
        </p>
      )}

      {selected && current && (
        <div className="space-tools" role="toolbar" aria-label="Selected photo">
          <Button
            onClick={() => {
              const index = photos.findIndex((p) => p.id === selected);
              if (index >= 0) onOpen(index);
            }}
          >
            Open
          </Button>
          {scene && (
            <Button
              onClick={() => edit(selected, { ...current, yaw: faceYaw(current, scene.eye()) })}
            >
              Face me
            </Button>
          )}
          <Button
            aria-label="Turn left"
            onClick={() => edit(selected, { ...current, yaw: current.yaw - 15 })}
          >
            &#x21BA;
          </Button>
          <Button
            aria-label="Turn right"
            onClick={() => edit(selected, { ...current, yaw: current.yaw + 15 })}
          >
            &#x21BB;
          </Button>
          <Button
            aria-label="Smaller"
            onClick={() => edit(selected, { ...current, s: current.s / 1.15 })}
          >
            &minus;
          </Button>
          <Button
            aria-label="Bigger"
            onClick={() => edit(selected, { ...current, s: current.s * 1.15 })}
          >
            +
          </Button>
        </div>
      )}

      <p className="space-hint">{HINT}</p>

      {/* the canvas is one <canvas>; these give keyboards and screen readers a way in */}
      <ul className="sr-only" aria-label="Photos in the canvas">
        {photos.map((photo, index) => {
          const p = layout[photo.id];
          if (!p) return null;
          return (
            <li key={photo.id}>
              <button
                type="button"
                aria-label={`Photo ${index + 1} by ${displayName(photo.uploader_name)}`}
                aria-pressed={selected === photo.id}
                data-testid={`card-${photo.id}`}
                data-x={p.x}
                data-y={p.y}
                data-z={p.z}
                data-yaw={p.yaw}
                data-r={p.r}
                data-s={p.s}
                onFocus={() => setSelected(photo.id)}
                onKeyDown={(e) => onKey(e, photo.id, index)}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
