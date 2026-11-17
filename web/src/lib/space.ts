import type { Layout, Photo, Placement } from "./api";

// World bounds, y up; the backend validates against the same numbers (api/gallery.py).
export const SPACE_HALF = 3000;
export const SPACE_H = 3000;
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;
// longest side of a photo at scale 1, in world units
export const CARD_PX = 360;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;
const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const DEG = Math.PI / 180;

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
  return {
    x: round(clamp(p.x, -SPACE_HALF, SPACE_HALF), 1),
    y: round(clamp(p.y, 0, SPACE_H), 1),
    z: round(clamp(p.z, -SPACE_HALF, SPACE_HALF), 1),
    yaw: round(wrapDeg(p.yaw), 1),
    r: round(wrapDeg(p.r), 1),
    s: round(clamp(p.s, MIN_SCALE, MAX_SCALE), 3),
  };
}

/**
 * Photo `index` of `total` on a loose wall facing +z, centred on x = 0, standing on the
 * floor, nudged off the wall plane by `depth`. Shrinks to fit when there are lots.
 */
export function defaultPlacement(id: string, index: number, total: number, depth = 0): Placement {
  const cols = Math.max(1, Math.ceil(Math.sqrt(total * 1.6)));
  const rows = Math.max(1, Math.ceil(total / cols));
  const cell = Math.min(CARD_PX * 1.3, (2 * SPACE_HALF * 0.9) / cols, (SPACE_H * 0.9) / rows);
  const col = index % cols;
  const row = Math.floor(index / cols);
  const j = (k: string) => hash01(id + k) - 0.5;
  return clampPlacement({
    x: (col - (cols - 1) / 2) * cell + j("x") * cell * 0.2,
    y: 40 + (rows - row - 0.5) * cell + j("y") * cell * 0.15,
    z: depth + j("z") * cell * 0.6,
    yaw: j("yaw") * 24,
    r: j("r") * 12,
    s: cell / (CARD_PX * 1.3),
  });
}

/** Saved placements win; photos the layout doesn't know yet go on a wall in front. */
export function resolveLayout(photos: Pick<Photo, "id">[], saved: Layout): Layout {
  const out: Layout = {};
  const fresh = photos.filter((p) => !saved[p.id]);
  photos.forEach((p) => {
    if (saved[p.id]) out[p.id] = saved[p.id];
  });
  const kept = Object.values(out);
  const depth = kept.length ? Math.max(...kept.map((p) => p.z)) + CARD_PX : 0;
  fresh.forEach((p, i) => {
    out[p.id] = defaultPlacement(p.id, i, fresh.length, depth);
  });
  return out;
}

/** Yaw that turns a photo at `from` to face `to` (its front looks down +z at yaw 0). */
export function faceYaw(from: Vec3, to: Vec3): number {
  return round(Math.atan2(to.x - from.x, to.z - from.z) / DEG, 1);
}

/**
 * Keyboard edits, relative to where the camera looks from (`viewYaw`, degrees round the
 * vertical, 0 = looking down -z): arrows slide across/into the scene, PageUp/PageDown
 * lift, [ ] tilt, , . turn, - + size. Shift for bigger steps.
 */
export function keyEdit(p: Placement, key: string, big: boolean, viewYaw = 0): Placement | null {
  const step = big ? 100 : 20;
  const turn = big ? 15 : 5;
  const zoom = big ? 1.25 : 1.05;
  const a = viewYaw * DEG;
  const right = { x: Math.cos(a), z: -Math.sin(a) };
  const back = { x: Math.sin(a), z: Math.cos(a) };
  const slide = (d: { x: number; z: number }, k: number) => ({
    x: p.x + d.x * k * step,
    z: p.z + d.z * k * step,
  });
  const edits: Record<string, Partial<Placement>> = {
    ArrowLeft: slide(right, -1),
    ArrowRight: slide(right, 1),
    ArrowUp: slide(back, -1),
    ArrowDown: slide(back, 1),
    PageUp: { y: p.y + step },
    PageDown: { y: p.y - step },
    "[": { r: p.r - turn },
    "]": { r: p.r + turn },
    ",": { yaw: p.yaw - turn },
    ".": { yaw: p.yaw + turn },
    "-": { s: p.s / zoom },
    "+": { s: p.s * zoom },
    "=": { s: p.s * zoom },
  };
  return key in edits ? clampPlacement({ ...p, ...edits[key] }) : null;
}

/** Where a ray meets a plane, or null if it runs parallel or points away. */
export function planeHit(origin: Vec3, dir: Vec3, point: Vec3, normal: Vec3): Vec3 | null {
  const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
  const denom = dot(dir, normal);
  if (Math.abs(denom) < 1e-6) return null;
  const t = dot({ x: point.x - origin.x, y: point.y - origin.y, z: point.z - origin.z }, normal);
  const k = t / denom;
  if (k < 0) return null;
  return { x: origin.x + dir.x * k, y: origin.y + dir.y * k, z: origin.z + dir.z * k };
}

export interface View {
  target: Vec3;
  position: Vec3;
}

/** Camera that takes in every photo, looking at the layout from the front (+z), a bit above. */
export function fitView(
  layout: Layout,
  photos: Pick<Photo, "id" | "width" | "height">[],
  vfovDeg: number,
  aspect: number,
): View {
  const placed = photos.filter((p) => layout[p.id]);
  if (!placed.length) {
    return { target: { x: 0, y: 300, z: 0 }, position: { x: 0, y: 500, z: 1600 } };
  }
  const lo = { x: Infinity, y: Infinity, z: Infinity };
  const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const photo of placed) {
    const p = layout[photo.id];
    const { w, h } = cardSize(photo);
    const half = (Math.max(w, h) * p.s) / 2;
    for (const k of ["x", "y", "z"] as const) {
      lo[k] = Math.min(lo[k], p[k] - half);
      hi[k] = Math.max(hi[k], p[k] + half);
    }
  }
  const target = { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2, z: (lo.z + hi.z) / 2 };
  const halfW = (hi.x - lo.x) / 2;
  const halfH = (hi.y - lo.y) / 2;
  const tanV = Math.tan((vfovDeg * DEG) / 2);
  const dist = Math.max(halfH / tanV, halfW / (tanV * aspect)) * 1.15 + (hi.z - lo.z) / 2;
  const lift = dist * 0.2;
  return { target, position: { x: target.x, y: target.y + lift, z: target.z + dist } };
}
