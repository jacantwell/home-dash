import { describe, expect, it } from "vitest";

import {
  formatAbsolute,
  formatApacheDay,
  formatApacheStamp,
  formatEventWhen,
  formatRelative,
  londonToday,
} from "./time";

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

describe("formatEventWhen", () => {
  it.each([
    [
      "timed, same day (BST)",
      { start: "2026-10-02T19:30:00+01:00", end: "2026-10-02T21:00:00+01:00", all_day: false },
      "Fri 2 Oct, 19:30–21:00",
    ],
    [
      "timed, given in UTC, shown in London",
      { start: "2026-10-02T18:30:00Z", end: "2026-10-02T20:00:00Z", all_day: false },
      "Fri 2 Oct, 19:30–21:00",
    ],
    [
      "timed, GMT after the clocks go back",
      { start: "2026-11-06T19:00:00Z", end: "2026-11-06T20:00:00Z", all_day: false },
      "Fri 6 Nov, 19:00–20:00",
    ],
    [
      "timed, past midnight",
      { start: "2026-10-02T22:00:00+01:00", end: "2026-10-03T02:00:00+01:00", all_day: false },
      "Fri 2 Oct, 22:00 – Sat 3 Oct 02:00",
    ],
    ["all day", { start: "2026-10-03", end: "2026-10-04", all_day: true }, "Sat 3 Oct (all day)"],
    [
      "all day, several days",
      { start: "2026-10-03", end: "2026-10-06", all_day: true },
      "Sat 3 Oct – Mon 5 Oct",
    ],
    [
      "all day, across a month end",
      { start: "2026-10-31", end: "2026-11-02", all_day: true },
      "Sat 31 Oct – Sun 1 Nov",
    ],
  ])("%s", (_name, event, expected) => {
    expect(formatEventWhen(event)).toBe(expected);
  });
});

describe("londonToday", () => {
  it.each([
    ["midday UTC", "2026-09-06T12:00:00Z", "2026-09-06"],
    ["just after midnight BST, still the 6th in UTC", "2026-09-06T23:30:00Z", "2026-09-07"],
    ["late evening GMT", "2026-12-31T23:30:00Z", "2026-12-31"],
  ])("%s", (_name, iso, expected) => {
    expect(londonToday(new Date(iso))).toBe(expected);
  });
});
