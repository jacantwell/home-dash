import { describe, expect, it } from "vitest";

import {
  addDrinker,
  type Drinker,
  MAX_PEOPLE,
  nextBuyer,
  normaliseName,
  recordRound,
  totalRounds,
} from "./rounds";

const crew = (...rounds: number[]): Drinker[] =>
  rounds.map((r, i) => ({ name: `P${i + 1}`, rounds: r }));

describe("normaliseName", () => {
  it.each([
    ["Sam", "Sam"],
    ["  Sam  ", "Sam"],
    ["Big   Dave", "Big Dave"],
    ["a".repeat(24), "a".repeat(24)],
  ])("%j -> %j", (input, expected) => {
    expect(normaliseName(input)).toBe(expected);
  });

  it.each(["", "   ", "a".repeat(25)])("rejects %j", (input) => {
    expect(normaliseName(input)).toBeNull();
  });
});

describe("addDrinker", () => {
  it("adds a new name with no rounds", () => {
    expect(addDrinker([], " Sam ")).toEqual({ ok: true, drinkers: [{ name: "Sam", rounds: 0 }] });
  });

  it.each([
    [[{ name: "Sam", rounds: 0 }], "sam", "Sam is already out."],
    [[], "", "Names are 1 to 24 characters."],
    [crew(...Array<number>(MAX_PEOPLE).fill(0)), "Extra", "That's 20 already."],
  ])("refuses %j + %j", (drinkers, name, reason) => {
    expect(addDrinker(drinkers, name)).toEqual({ ok: false, reason });
  });
});

describe("nextBuyer", () => {
  it.each([
    [[], null],
    [crew(0), 0],
    [crew(0, 0, 0), 0],
    [crew(1, 0, 0), 1],
    [crew(1, 1, 0), 2],
    [crew(2, 1, 1), 1],
  ])("%j -> %j", (drinkers, expected) => {
    expect(nextBuyer(drinkers)).toBe(expected);
  });
});

describe("recordRound", () => {
  it.each([
    [crew(0, 0), crew(1, 0)],
    [crew(1, 0), crew(1, 1)],
    [crew(1, 1, 0), crew(1, 1, 1)],
    [[], []],
  ])("%j -> %j", (before, after) => {
    expect(recordRound(before)).toEqual(after);
  });
});

describe("totalRounds", () => {
  it.each([
    [[], 0],
    [crew(1, 2, 3), 6],
  ])("%j -> %d", (drinkers, expected) => {
    expect(totalRounds(drinkers)).toBe(expected);
  });
});
