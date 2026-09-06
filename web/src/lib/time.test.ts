import { describe, expect, it } from "vitest";

import { formatAbsolute, formatRelative } from "./time";

const now = new Date("2026-09-06T12:00:00Z");

describe("formatRelative", () => {
  it.each([
    ["2026-09-06T11:59:50Z", "just now"],
    ["2026-09-06T11:58:00Z", "2 minutes ago"],
    ["2026-09-06T09:00:00Z", "3 hours ago"],
    ["2026-09-04T12:00:00Z", "2 days ago"],
    ["2026-09-05T12:00:00Z", "yesterday"],
    ["garbage", ""],
  ])("%s -> %s", (iso, expected) => {
    expect(formatRelative(iso, now)).toBe(expected);
  });
});

describe("formatAbsolute", () => {
  it("returns empty for invalid dates", () => {
    expect(formatAbsolute("nope")).toBe("");
  });

  it("formats valid dates", () => {
    expect(formatAbsolute("2026-09-06T12:00:00Z")).not.toBe("");
  });
});
