import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadPhoto } from "./space-scene";

const URL = "https://cdn.test/p1/display.jpg?sig";
const ok = () => new Response(new Blob(["jpg"]), { status: 200 });
const corsBlocked = () => Promise.reject(new TypeError("Failed to fetch"));

describe("loadPhoto", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const bitmap = { width: 4, height: 3 };

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => bitmap),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["uses the cache when it can", [ok], ["default"]],
    ["re-fetches past a cached copy that fails CORS", [corsBlocked, ok], ["default", "reload"]],
    [
      "re-fetches after an error status",
      [() => new Response(null, { status: 503 }), ok],
      ["default", "reload"],
    ],
  ])("%s", async (_, responses, caches) => {
    responses.forEach((r) => fetchMock.mockImplementationOnce(async () => r()));
    const tex = await loadPhoto(URL);
    expect(tex.image).toBe(bitmap);
    expect(tex.flipY).toBe(false);
    expect(fetchMock.mock.calls.map(([, init]) => init?.cache)).toEqual(caches);
    expect(fetchMock.mock.calls.every(([url, init]) => url === URL && init?.mode === "cors")).toBe(
      true,
    );
  });

  it("gives up if the re-fetch fails too", async () => {
    fetchMock.mockImplementation(corsBlocked);
    await expect(loadPhoto(URL)).rejects.toThrow("Failed to fetch");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
