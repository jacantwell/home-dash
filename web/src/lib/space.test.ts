import { describe, expect, it } from "vitest";

import type { Placement } from "./api";
import {
  CARD_PX,
  cardSize,
  clampPlacement,
  defaultPlacement,
  faceYaw,
  fitView,
  frameSize,
  hash01,
  keyEdit,
  MAX_SCALE,
  MIN_SCALE,
  planeHit,
  resolveLayout,
  scatter,
  SPACE_H,
  SPACE_HALF,
} from "./space";

const at = (over: Partial<Placement> = {}): Placement => ({
  x: 100,
  y: 300,
  z: 0,
  yaw: 0,
  r: 0,
  s: 1,
  ...over,
});

const photos = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, width: 4000, height: 3000 }));

describe("hash01", () => {
  it.each(["a", "photo-1", "f7c1c2a0-0000-4000-8000-000000000000"])(
    "is stable in [0,1) for %s",
    (id) => {
      const h = hash01(id);
      expect(h).toBe(hash01(id));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    },
  );
});

describe("cardSize / frameSize", () => {
  it.each([
    [4000, 3000, CARD_PX, 270],
    [3000, 4000, 270, CARD_PX],
    [1000, 1000, CARD_PX, CARD_PX],
  ])("%ix%i -> photo %ix%i", (width, height, w, h) => {
    expect(cardSize({ width, height })).toEqual({ w, h });
    expect(frameSize({ width, height })).toEqual({ w: w + 28, h: h + 70 });
  });
});

describe("clampPlacement", () => {
  it.each([
    ["x past -edge", at({ x: -SPACE_HALF - 1 }), { x: -SPACE_HALF }],
    ["x past +edge", at({ x: SPACE_HALF + 1 }), { x: SPACE_HALF }],
    ["z past -edge", at({ z: -SPACE_HALF - 1 }), { z: -SPACE_HALF }],
    ["z past +edge", at({ z: SPACE_HALF + 1 }), { z: SPACE_HALF }],
    ["y under the floor", at({ y: -5 }), { y: 0 }],
    ["y through the roof", at({ y: SPACE_H + 1 }), { y: SPACE_H }],
    ["scale too small", at({ s: 0.01 }), { s: MIN_SCALE }],
    ["scale too big", at({ s: 99 }), { s: MAX_SCALE }],
    ["roll wraps past 180", at({ r: 190 }), { r: -170 }],
    ["yaw wraps past -180", at({ yaw: -190 }), { yaw: 170 }],
    ["rounds position", at({ x: 1.23456 }), { x: 1.2 }],
  ])("%s", (_, input, expected) => {
    expect(clampPlacement(input)).toMatchObject(expected);
  });
});

describe("defaultPlacement", () => {
  it.each([1, 7, 40, 2000])("keeps %i photos inside the space", (total) => {
    for (const i of [0, Math.floor(total / 2), total - 1]) {
      const p = defaultPlacement(`p${i}`, i, total);
      expect(p).toEqual(clampPlacement(p));
      expect(Math.abs(p.x)).toBeLessThan(SPACE_HALF);
      expect(p.y).toBeGreaterThan(0);
    }
  });

  it.each([0, 500])("sits around depth %i", (depth) => {
    expect(Math.abs(defaultPlacement("a", 0, 1, depth).z - depth)).toBeLessThan(CARD_PX);
  });
});

describe("resolveLayout", () => {
  it("keeps saved placements and puts new photos in front of them", () => {
    const saved = { p0: at({ z: 200 }) };
    const out = resolveLayout(photos(3), saved);
    expect(out.p0).toBe(saved.p0);
    expect(out.p1.z).toBeGreaterThan(200);
    expect(out.p2.z).toBeGreaterThan(200);
  });

  it("drops placements for photos that are gone", () => {
    expect(Object.keys(resolveLayout(photos(1), { gone: at() }))).toEqual(["p0"]);
  });

  it("scatter places everything", () => {
    expect(Object.keys(scatter(photos(4))).sort()).toEqual(["p0", "p1", "p2", "p3"]);
  });
});

describe("faceYaw", () => {
  it.each([
    [{ x: 0, y: 0, z: 1000 }, 0],
    [{ x: 1000, y: 0, z: 0 }, 90],
    [{ x: -1000, y: 0, z: 0 }, -90],
    [{ x: 0, y: 500, z: -1000 }, 180],
  ])("to %o is %i", (to, yaw) => {
    expect(Math.abs(faceYaw({ x: 0, y: 0, z: 0 }, to))).toBeCloseTo(Math.abs(yaw));
  });
});

describe("keyEdit", () => {
  const p = at({ x: 0, y: 300, z: 0 });
  it.each([
    ["ArrowRight", false, 0, { x: 20, z: 0 }],
    ["ArrowLeft", true, 0, { x: -100, z: 0 }],
    ["ArrowUp", false, 0, { x: 0, z: -20 }],
    ["ArrowDown", false, 0, { x: 0, z: 20 }],
    // looking from +x (camera swung round 90deg): right is now -z, away is -x
    ["ArrowRight", false, 90, { x: 0, z: -20 }],
    ["ArrowUp", false, 90, { x: -20, z: 0 }],
    ["PageUp", false, 0, { y: 320 }],
    ["PageDown", true, 0, { y: 200 }],
    ["[", false, 0, { r: -5 }],
    ["]", true, 0, { r: 15 }],
    [",", false, 0, { yaw: -5 }],
    [".", true, 0, { yaw: 15 }],
    ["+", false, 0, { s: 1.05 }],
    ["=", true, 0, { s: 1.25 }],
    ["-", true, 0, { s: 0.8 }],
  ])("%s (shift=%s, view %i)", (key, big, view, expected) => {
    const out = keyEdit(p, key, big, view)!;
    for (const [k, v] of Object.entries(expected)) {
      expect(out[k as keyof Placement]).toBeCloseTo(v);
    }
  });

  it("ignores other keys", () => {
    expect(keyEdit(p, "a", false)).toBeNull();
  });
});

describe("planeHit", () => {
  const origin = { x: 0, y: 100, z: 1000 };
  it.each([
    ["straight ahead", { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 100, z: 0 }],
    ["down to the floor", { x: 0, y: -1, z: -1 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 900 }],
    ["parallel", { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, null],
    ["facing away", { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }, null],
  ])("%s", (_, dir, normal, expected) => {
    const hit = planeHit(origin, dir, { x: 0, y: 0, z: 0 }, normal);
    if (expected === null) return expect(hit).toBeNull();
    expect(hit!.x).toBeCloseTo(expected.x);
    expect(hit!.y).toBeCloseTo(expected.y);
    expect(hit!.z).toBeCloseTo(expected.z);
  });
});

describe("fitView", () => {
  it("looks at an empty space from the front", () => {
    const v = fitView({}, [], 50, 1.5);
    expect(v.position.z).toBeGreaterThan(v.target.z);
  });

  it.each([1, 9, 60])("backs off far enough to see %i photos", (n) => {
    const ps = photos(n);
    const layout = scatter(ps);
    const v = fitView(layout, ps, 50, 1.5);
    const xs = Object.values(layout).map((p) => Math.abs(p.x - v.target.x) + CARD_PX / 2);
    const dist = v.position.z - v.target.z;
    const halfWidth = Math.tan((25 * Math.PI) / 180) * 1.5 * dist;
    expect(Math.max(...xs)).toBeLessThan(halfWidth);
  });
});
