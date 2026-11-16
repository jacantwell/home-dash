import type { Layout, Photo, Placement } from "./api";

// Board coordinates; the backend validates against the same bounds (api/gallery.py).
export const BOARD_W = 2400;
export const BOARD_H = 1600;
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;
// longest side of a photo at scale 1, in board units
export const CARD_PX = 360;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Stable 0..1 from a string, so a photo's default jitter doesn't move between renders. */
export function hash01(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 2 ** 32;
}

export function cardSize(photo: Pick<Photo, "width" | "height">): { w: number; h: number } {
  const ratio = photo.width / photo.height;
  return ratio >= 1
    ? { w: CARD_PX, h: Math.round(CARD_PX / ratio) }
    : { w: Math.round(CARD_PX * ratio), h: CARD_PX };
}

export function clampPlacement(p: Placement): Placement {
  // wrap rotation into -180..180
  const r = ((((p.r + 180) % 360) + 360) % 360) - 180;
  return {
    x: clamp(p.x, 0, BOARD_W),
    y: clamp(p.y, 0, BOARD_H),
    r: Math.round(r * 10) / 10,
    s: Math.round(clamp(p.s, MIN_SCALE, MAX_SCALE) * 1000) / 1000,
    z: Math.max(0, Math.round(p.z)),
  };
}

/** Scatter photo `index` of `total` across a loose grid with a bit of tilt. */
export function defaultPlacement(id: string, index: number, total: number): Placement {
  const cols = Math.max(1, Math.ceil(Math.sqrt((total * BOARD_W) / BOARD_H)));
  const rows = Math.max(1, Math.ceil(total / cols));
  const cellW = BOARD_W / cols;
  const cellH = BOARD_H / rows;
  const jx = hash01(id + "x") - 0.5;
  const jy = hash01(id + "y") - 0.5;
  const jr = hash01(id + "r") - 0.5;
  return clampPlacement({
    x: (index % cols) * cellW + cellW / 2 + jx * cellW * 0.3,
    y: Math.floor(index / cols) * cellH + cellH / 2 + jy * cellH * 0.3,
    r: jr * 16,
    s: Math.min(1, (Math.min(cellW, cellH) * 0.95) / CARD_PX),
    z: index,
  });
}

/** Saved placements win; photos the layout doesn't know yet are scattered on top. */
export function resolveLayout(photos: Pick<Photo, "id">[], saved: Layout): Layout {
  const out: Layout = {};
  let top = Math.max(-1, ...Object.values(saved).map((p) => p.z));
  const fresh = photos.filter((p) => !saved[p.id]);
  photos.forEach((p) => {
    if (saved[p.id]) out[p.id] = saved[p.id];
  });
  fresh.forEach((p, i) => {
    out[p.id] = { ...defaultPlacement(p.id, i, fresh.length), z: ++top };
  });
  return out;
}

export function scatter(photos: Pick<Photo, "id">[]): Layout {
  return Object.fromEntries(photos.map((p, i) => [p.id, defaultPlacement(p.id, i, photos.length)]));
}

export function bringToFront(layout: Layout, id: string): Layout {
  const top = Math.max(...Object.values(layout).map((p) => p.z));
  if (layout[id].z === top && Object.values(layout).filter((p) => p.z === top).length === 1) {
    return layout;
  }
  return { ...layout, [id]: { ...layout[id], z: top + 1 } };
}

interface Point {
  x: number;
  y: number;
}

/**
 * Corner-handle gesture: rotate by how far the pointer swung around the card's centre
 * and scale by how much further from it it got. All points in the same space.
 */
export function rotateScale(
  start: Placement,
  centre: Point,
  from: Point,
  to: Point,
): Pick<Placement, "r" | "s"> {
  const a0 = Math.atan2(from.y - centre.y, from.x - centre.x);
  const a1 = Math.atan2(to.y - centre.y, to.x - centre.x);
  const d0 = Math.hypot(from.x - centre.x, from.y - centre.y) || 1;
  const d1 = Math.hypot(to.x - centre.x, to.y - centre.y);
  const { r, s } = clampPlacement({
    ...start,
    r: start.r + ((a1 - a0) * 180) / Math.PI,
    s: (start.s * d1) / d0,
  });
  return { r, s };
}
