import { describe, expect, it } from "vitest";

import type { Layout, Placement } from "./api";
import {
  BOARD_H,
  BOARD_W,
  bringToFront,
  CARD_PX,
  cardSize,
  clampPlacement,
  defaultPlacement,
  hash01,
  MAX_SCALE,
  MIN_SCALE,
  resolveLayout,
  rotateScale,
  scatter,
} from "./canvas";

const at = (over: Partial<Placement> = {}): Placement => ({
  x: 100,
  y: 100,
  r: 0,
  s: 1,
  z: 0,
  ...over,
});

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

describe("cardSize", () => {
  it.each([
    [4000, 3000, CARD_PX, 270],
    [3000, 4000, 270, CARD_PX],
    [1000, 1000, CARD_PX, CARD_PX],
  ])("%ix%i -> %ix%i", (width, height, w, h) => {
    expect(cardSize({ width, height })).toEqual({ w, h });
  });
});

describe("clampPlacement", () => {
  it.each([
    ["x below 0", at({ x: -5 }), { x: 0 }],
    ["x past the board", at({ x: BOARD_W + 1 }), { x: BOARD_W }],
    ["y past the board", at({ y: BOARD_H + 1 }), { y: BOARD_H }],
    ["scale too small", at({ s: 0.01 }), { s: MIN_SCALE }],
    ["scale too big", at({ s: 99 }), { s: MAX_SCALE }],
    ["rotation wraps past 180", at({ r: 190 }), { r: -170 }],
    ["rotation wraps past -180", at({ r: -190 }), { r: 170 }],
    ["negative z", at({ z: -3 }), { z: 0 }],
  ])("%s", (_label, input, expected) => {
    expect(clampPlacement(input)).toMatchObject(expected);
  });
});

describe("defaultPlacement", () => {
  it.each([1, 5, 40])("keeps all %i photos on the board", (total) => {
    for (let i = 0; i < total; i++) {
      const p = defaultPlacement(`p${i}`, i, total);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(BOARD_W);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(BOARD_H);
      expect(Math.abs(p.r)).toBeLessThanOrEqual(8);
      expect(p.z).toBe(i);
    }
  });

  it("is deterministic per id", () => {
    expect(defaultPlacement("same", 2, 9)).toEqual(defaultPlacement("same", 2, 9));
  });
});

describe("resolveLayout", () => {
  it("keeps saved placements, stacks new photos on top and drops strangers", () => {
    const saved: Layout = { a: at({ z: 7 }), gone: at({ z: 99 }) };
    const out = resolveLayout([{ id: "a" }, { id: "b" }, { id: "c" }], saved);
    expect(Object.keys(out)).toEqual(["a", "b", "c"]);
    expect(out.a).toBe(saved.a);
    // stacking starts above the highest saved z, deleted photos included
    expect([out.b.z, out.c.z]).toEqual([100, 101]);
  });

  it("scatters everything when nothing is saved", () => {
    const out = resolveLayout([{ id: "a" }, { id: "b" }], {});
    expect([out.a.z, out.b.z]).toEqual([0, 1]);
  });
});

describe("scatter", () => {
  it("places every photo, ignoring what was there", () => {
    expect(Object.keys(scatter([{ id: "a" }, { id: "b" }]))).toEqual(["a", "b"]);
  });
});

describe("bringToFront", () => {
  it.each([
    ["already alone on top", { a: at({ z: 1 }), b: at({ z: 5 }) }, "b", 5, true],
    ["tied on top", { a: at({ z: 5 }), b: at({ z: 5 }) }, "b", 6, false],
    ["underneath", { a: at({ z: 1 }), b: at({ z: 5 }) }, "a", 6, false],
  ])("%s", (_label, layout, id, z, same) => {
    const out = bringToFront(layout, id);
    expect(out[id].z).toBe(z);
    expect(out === layout).toBe(same);
  });
});

describe("rotateScale", () => {
  const centre = { x: 0, y: 0 };
  it.each([
    ["quarter turn clockwise", { x: 10, y: 0 }, { x: 0, y: 10 }, 90, 1],
    ["quarter turn back", { x: 10, y: 0 }, { x: 0, y: -10 }, -90, 1],
    ["drag out doubles", { x: 10, y: 0 }, { x: 20, y: 0 }, 0, 2],
    ["drag in halves", { x: 10, y: 0 }, { x: 5, y: 0 }, 0, 0.5],
    ["clamped to max scale", { x: 1, y: 0 }, { x: 100, y: 0 }, 0, MAX_SCALE],
  ])("%s", (_label, from, to, r, s) => {
    expect(rotateScale(at(), centre, from, to)).toEqual({ r, s });
  });

  it("adds to the starting rotation and scale", () => {
    expect(rotateScale(at({ r: 10, s: 2 }), centre, { x: 10, y: 0 }, { x: 0, y: 20 })).toEqual({
      r: 100,
      s: 4,
    });
  });
});
