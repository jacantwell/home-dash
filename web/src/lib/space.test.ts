import { describe, expect, it } from "vitest";

import type { Placement } from "./api";
import {
  CARD_PX,
  cardSize,
  clampPlacement,
  defaultPlacement,
  faceYaw,
  fitView,
  hash01,
  keyEdit,
  MAX_SCALE,
  MIN_SCALE,
  planeHit,
  resolveLayout,
  SPACE_H,
  SPACE_HALF,
  ahead,
  alongPath,
  clampStep,
  DOOR_HALF,
  entrance,
  EYE_H,
  HALL_END,
  HALL_HALF,
  HALL_START,
  keepInside,
  lookBy,
  MAX_PITCH,
  ROOM_HALF,
  stance,
  tapStep,
  walkIntent,
  WALK_HALF,
  WALL_GAP,
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

describe("cardSize", () => {
  it.each([
    [4000, 3000, CARD_PX, 270],
    [3000, 4000, 270, CARD_PX],
    [1000, 1000, CARD_PX, CARD_PX],
  ])("%ix%i -> photo %ix%i", (width, height, w, h) => {
    expect(cardSize({ width, height })).toEqual({ w, h });
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
    const layout = resolveLayout(ps, {});
    const v = fitView(layout, ps, 50, 1.5);
    const xs = Object.values(layout).map((p) => Math.abs(p.x - v.target.x) + CARD_PX / 2);
    const dist = v.position.z - v.target.z;
    const halfWidth = Math.tan((25 * Math.PI) / 180) * 1.5 * dist;
    expect(Math.max(...xs)).toBeLessThan(halfWidth);
  });
});

const v = (x: number, z: number, y = 0) => ({ x, y, z });

describe("walkIntent", () => {
  it.each([
    [[], { forward: 0, turn: 0, fast: false }],
    [["ArrowUp"], { forward: 1, turn: 0, fast: false }],
    [["ArrowDown", "Shift"], { forward: -1, turn: 0, fast: true }],
    [["ArrowLeft"], { forward: 0, turn: 1, fast: false }],
    [["ArrowRight", "ArrowUp"], { forward: 1, turn: -1, fast: false }],
    [["ArrowLeft", "ArrowRight"], { forward: 0, turn: 0, fast: false }],
    [["a", "Enter"], { forward: 0, turn: 0, fast: false }],
  ])("%o", (keys, expected) => {
    expect(walkIntent(new Set(keys))).toEqual(expected);
  });
});

describe("ahead", () => {
  it.each([
    [0, { x: 0, z: -1 }],
    [90, { x: -1, z: 0 }],
    [-90, { x: 1, z: 0 }],
    [180, { x: 0, z: 1 }],
  ])("yaw %i faces %o", (yaw, expected) => {
    const d = ahead(yaw);
    expect(d.x).toBeCloseTo(expected.x);
    expect(d.z).toBeCloseTo(expected.z);
  });
});

describe("clampStep", () => {
  const HALL_WALK = DOOR_HALF - WALL_GAP;
  it.each([
    ["inside: untouched", { x: 100, z: -200 }, { x: 0, z: 1000 }, { x: 100, z: -200 }],
    ["stops at the back wall", { x: 0, z: -500 }, { x: 0, z: -WALK_HALF + 50 }, { x: 0, z: -50 }],
    ["slides along a side wall", { x: 300, z: 300 }, { x: WALK_HALF, z: 0 }, { x: 0, z: 300 }],
    ["stops at the front wall", { x: 0, z: 500 }, { x: 2000, z: WALK_HALF - 50 }, { x: 0, z: 50 }],
    ["walks out the door", { x: 0, z: 500 }, { x: 0, z: WALK_HALF - 50 }, { x: 0, z: 500 }],
    [
      "hallway walls hem you in",
      { x: 500, z: 0 },
      { x: 0, z: ROOM_HALF + 500 },
      { x: HALL_WALK, z: 0 },
    ],
    [
      "stops at the end of the hallway",
      { x: 0, z: 1000 },
      { x: 0, z: HALL_END - 300 },
      { x: 0, z: 300 - WALL_GAP },
    ],
    // past the walls, walking in still works, walking further out doesn't
    ["outside, walking in", { x: 0, z: 400 }, { x: 0, z: -WALK_HALF - 900 }, { x: 0, z: 400 }],
    ["outside, walking out", { x: 0, z: -400 }, { x: 0, z: -WALK_HALF - 900 }, { x: 0, z: 0 }],
  ])("%s", (_, step, at, expected) => {
    const s = clampStep(step, at);
    expect(s.x).toBeCloseTo(expected.x);
    expect(s.z).toBeCloseTo(expected.z);
  });
});

describe("lookBy", () => {
  const s = { x: 1, z: 2, yaw: 0, pitch: 0 };
  it.each([
    ["turns left", 30, 0, { yaw: 30, pitch: 0 }],
    ["looks up", 0, 20, { yaw: 0, pitch: 20 }],
    ["wraps round", 200, 0, { yaw: -160, pitch: 0 }],
    ["stops short of straight up", 0, 500, { yaw: 0, pitch: MAX_PITCH }],
    ["stops short of straight down", 0, -500, { yaw: 0, pitch: -MAX_PITCH }],
  ])("%s", (_, dx, dy, expected) => {
    expect(lookBy(s, dx, dy)).toEqual({ x: 1, z: 2, ...expected });
  });
});

describe("tapStep", () => {
  const at = { x: 0, z: 1000 };
  it.each([
    ["walks to the spot", v(300, -500), { x: 300, z: -1500 }],
    ["walks right up to the back wall", v(0, -ROOM_HALF), { x: 0, z: -WALK_HALF - 1000 }],
    ["walks into the hallway", v(0, ROOM_HALF + 1000), { x: 0, z: ROOM_HALF }],
    ["ignores ground past the walls", v(ROOM_HALF + 1, 0), null],
    ["ignores ground past the walls (z)", v(0, -ROOM_HALF - 1), null],
    ["ignores ground beside the hallway", v(HALL_HALF + 1, ROOM_HALF + 500), null],
  ])("%s", (_, spot, expected) => {
    const s = tapStep(spot, at);
    if (expected === null) return expect(s).toBeNull();
    expect(s!.x).toBeCloseTo(expected.x);
    expect(s!.z).toBeCloseTo(expected.z);
  });
});

describe("stance", () => {
  it.each([
    // in front of the wall, looking at it level from eye height
    ["level", v(0, 0, EYE_H), v(0, 1000, 900), { x: 0, z: 1000, yaw: 0, pitch: 0 }],
    ["looking up", v(0, 0, EYE_H + 1000), v(0, 1000), { x: 0, z: 1000, yaw: 0, pitch: 45 }],
    ["from the side", v(0, 0, EYE_H), v(1000, 0), { x: 1000, z: 0, yaw: 90, pitch: 0 }],
  ])("%s", (_, target, position, expected) => {
    const s = stance({ target, position });
    for (const k of ["x", "z", "yaw", "pitch"] as const) expect(s[k]).toBeCloseTo(expected[k]);
  });
});

const st = (x: number, z: number, yaw = 0, pitch = 0) => ({ x, z, yaw, pitch });

describe("keepInside", () => {
  it.each([
    ["inside: untouched", st(100, -200, 30, 5), st(100, -200, 30, 5)],
    ["past the walls", st(9000, -9000, 30), st(WALK_HALF, -WALK_HALF, 30)],
  ])("%s", (_, s, expected) => {
    expect(keepInside(s)).toEqual(expected);
  });
});

describe("entrance", () => {
  it.each([
    ["ends where it's sent", st(1000, 2000, 20, 5), st(1000, 2000, 20, 5)],
    ["pulls a far-back view into the room", st(0, 9000, 0, -3), undefined],
  ])("%s", (_, to, expected) => {
    const path = entrance(to);
    expect(path[0]).toEqual(HALL_START);
    expect(HALL_START.z).toBeGreaterThan(ROOM_HALF);
    // straight through the doorway
    expect(path[1].x).toBe(0);
    expect(path[1].z).toBeLessThan(ROOM_HALF);
    const end = path[path.length - 1];
    expect(end.z).toBeLessThanOrEqual(path[1].z);
    if (expected) expect(end).toEqual(expected);
  });
});

describe("alongPath", () => {
  const path = [st(0, 0), st(0, -1000), st(1000, -1000, 90, 10)];
  it.each([
    ["start", 0, st(0, 0)],
    ["halfway down the first leg", 0.25, st(0, -500)],
    ["halfway down the second leg, half turned", 0.75, st(500, -1000, 45, 5)],
    ["end", 1, st(1000, -1000, 90, 10)],
    ["clamps past the end", 2, st(1000, -1000, 90, 10)],
  ])("%s", (_, t, expected) => {
    const s = alongPath(path, t);
    for (const k of ["x", "z", "yaw", "pitch"] as const) expect(s[k]).toBeCloseTo(expected[k]);
  });

  it.each([
    ["turns the short way round", [st(0, 0, 170), st(0, -100, -170)], 180],
    ["turns on the spot", [st(0, 0, 0), st(0, 0, 90)], 45],
  ])("%s", (_, p, yaw) => {
    expect(Math.abs(alongPath(p, 0.5).yaw)).toBeCloseTo(yaw);
  });
});
