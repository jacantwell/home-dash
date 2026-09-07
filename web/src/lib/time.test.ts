import { describe, expect, it } from "vitest";

import { formatAbsolute, formatApacheDay, formatApacheStamp, formatRelative } from "./time";

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

describe("formatApacheStamp", () => {
  it.each([
    [new Date(2026, 8, 6, 9, 5), "06-Sep-2026 09:05"],
    [new Date(2026, 0, 31, 23, 59), "31-Jan-2026 23:59"],
    [new Date(2026, 11, 1, 0, 0), "01-Dec-2026 00:00"],
  ])("%s -> %s", (d, expected) => {
    expect(formatApacheStamp(d)).toBe(expected);
  });
});

describe("formatApacheDay", () => {
  it.each([
    ["2026-09-01", "01-Sep-2026"],
    ["2026-12-31", "31-Dec-2026"],
    // no Date parsing, so a UTC-midnight date can't slip back a day in a western timezone
    ["2026-01-01", "01-Jan-2026"],
    ["nonsense", "nonsense"],
    ["2026-13-01", "2026-13-01"],
  ])("%s -> %s", (iso, expected) => {
    expect(formatApacheDay(iso)).toBe(expected);
  });
});
