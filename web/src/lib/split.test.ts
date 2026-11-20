import { describe, expect, it } from "vitest";

import { describeShares, formatPounds, parsePounds, splitBill } from "./split";

describe("parsePounds", () => {
  it.each([
    ["12", 1200],
    ["12.5", 1250],
    ["12.50", 1250],
    [" £31.01 ", 3101],
    ["1,234.56", 123456],
    ["0.01", 1],
  ])("%s -> %d pence", (input, expected) => {
    expect(parsePounds(input)).toBe(expected);
  });

  it.each(["", "0", "0.00", "-5", "12.345", "abc", "12.", "£", "1e3"])("rejects %j", (input) => {
    expect(parsePounds(input)).toBeNull();
  });
});

describe("splitBill", () => {
  it.each([
    // bill, people, tip %, tip, total, shares
    [3000, 3, 0, 0, 3000, [{ count: 3, pence: 1000 }]],
    [
      3100,
      3,
      0,
      0,
      3100,
      [
        { count: 1, pence: 1034 },
        { count: 2, pence: 1033 },
      ],
    ],
    [
      3101,
      3,
      0,
      0,
      3101,
      [
        { count: 2, pence: 1034 },
        { count: 1, pence: 1033 },
      ],
    ],
    [4000, 4, 12.5, 500, 4500, [{ count: 4, pence: 1125 }]],
    [1999, 1, 10, 200, 2199, [{ count: 1, pence: 2199 }]],
    [
      1,
      3,
      0,
      0,
      1,
      [
        { count: 1, pence: 1 },
        { count: 2, pence: 0 },
      ],
    ],
  ])("splits %d between %d with %d%% tip", (bill, people, tip, tipPence, total, shares) => {
    const split = splitBill(bill, people, tip);
    expect(split).toEqual({ billPence: bill, tipPence, totalPence: total, shares });
    expect(split.shares.reduce((sum, s) => sum + s.count * s.pence, 0)).toBe(total);
  });
});

describe("formatPounds", () => {
  it.each([
    [0, "£0.00"],
    [5, "£0.05"],
    [1034, "£10.34"],
    [123456, "£1,234.56"],
  ])("%d -> %s", (pence, expected) => {
    expect(formatPounds(pence)).toBe(expected);
  });
});

describe("describeShares", () => {
  it.each([
    [[{ count: 1, pence: 2199 }], "You pay £21.99"],
    [[{ count: 3, pence: 1000 }], "Each pays £10.00"],
    [
      [
        { count: 2, pence: 1034 },
        { count: 1, pence: 1033 },
      ],
      "2 pay £10.34, 1 pays £10.33",
    ],
    [
      [
        { count: 1, pence: 1034 },
        { count: 2, pence: 1033 },
      ],
      "1 pays £10.34, 2 pay £10.33",
    ],
  ])("%j -> %s", (shares, expected) => {
    expect(describeShares(shares)).toBe(expected);
  });
});
