import { describe, expect, it } from "vitest";

import { fitWithin, ImageError, photoContentType, prepareImage } from "./images";

describe("fitWithin", () => {
  it.each([
    [4032, 3024, 2048, 2048, 1536],
    [3024, 4032, 480, 360, 480],
    [800, 600, 2048, 800, 600],
    [5000, 1, 480, 480, 1],
  ])("%ix%i within %i -> %ix%i", (width, height, max, w, h) => {
    expect(fitWithin({ width, height }, max)).toEqual({ width: w, height: h });
  });
});

describe("photoContentType", () => {
  it.each([
    ["a.jpg", "image/jpeg", "image/jpeg"],
    ["a.PNG", "IMAGE/PNG", "image/png"],
    ["IMG_1.HEIC", "", "image/heic"],
    ["x.heif", "", "image/heif"],
    ["x.jpeg", "", "image/jpeg"],
    ["clip.mov", "video/quicktime", null],
    ["notes.txt", "", null],
    ["noext", "", null],
    ["a.jpg", "image/svg+xml", null],
  ])("%s (%j) -> %s", (name, type, expected) => {
    expect(photoContentType({ name, type })).toBe(expected);
  });
});

describe("prepareImage", () => {
  it.each([
    [
      "unsupported type",
      new File(["x"], "a.txt", { type: "text/plain" }),
      "isn't a supported photo",
    ],
    [
      "too big",
      Object.defineProperty(new File(["x"], "a.jpg", { type: "image/jpeg" }), "size", {
        value: 51 * 1024 * 1024,
      }),
      "bigger than 50 MB",
    ],
  ])("rejects a file that is %s", async (_label, file, message) => {
    await expect(prepareImage(file)).rejects.toThrow(ImageError);
    await expect(prepareImage(file)).rejects.toThrow(message);
  });
});
