import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Photo, UploadTicket } from "./api";
import type { PreparedImage } from "./images";
import { uploadAll, uploadPhoto } from "./upload";

const ticket: UploadTicket = {
  photo_id: "p1",
  uploads: {
    original: { url: "https://s3.test/", fields: { key: "albums/a/p1/original.jpg" } },
    display: { url: "https://s3.test/", fields: { key: "albums/a/p1/display.jpg" } },
    thumb: { url: "https://s3.test/", fields: { key: "albums/a/p1/thumb.jpg" } },
  },
};

const photo = { id: "p1", album_id: "a" } as Photo;

const prepared: PreparedImage = {
  width: 4032,
  height: 3024,
  contentType: "image/jpeg",
  display: new Blob(["d"]),
  thumb: new Blob(["t"]),
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

const fetchMock = vi.fn<typeof fetch>();
const getToken = vi.fn(async (): Promise<string | null> => "tok");
const prepare = vi.fn<(file: File) => Promise<PreparedImage>>(async () => prepared);

function route(fail?: { s3?: number; complete?: number }) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/photos")) return json(201, ticket);
    if (url.startsWith("https://s3.test")) return new Response(null, { status: fail?.s3 ?? 204 });
    if (url.endsWith("/complete")) {
      return fail?.complete
        ? json(fail.complete, { detail: "upload not finished: missing thumb" })
        : json(200, photo);
    }
    throw new Error(`unexpected ${url}`);
  });
}

const file = (name = "a.jpg") => new File(["orig"], name, { type: "image/jpeg" });

beforeEach(() => {
  fetchMock.mockReset();
  getToken.mockClear();
  prepare.mockClear();
});

describe("uploadPhoto", () => {
  it("reserves, posts all three variants to S3, then completes", async () => {
    route();
    const result = await uploadPhoto("a", file(), { getToken, prepare, fetchImpl: fetchMock });
    expect(result).toEqual(photo);

    const [startUrl, startInit] = fetchMock.mock.calls[0];
    expect(startUrl).toBe("/api/albums/a/photos");
    expect(JSON.parse(String(startInit?.body))).toEqual({
      content_type: "image/jpeg",
      bytes: 4,
      width: 4032,
      height: 3024,
    });

    const s3 = fetchMock.mock.calls.filter(([u]) => String(u).startsWith("https://s3.test"));
    const keys = s3.map(([, init]) => (init?.body as FormData).get("key"));
    expect(keys.sort()).toEqual([
      "albums/a/p1/display.jpg",
      "albums/a/p1/original.jpg",
      "albums/a/p1/thumb.jpg",
    ]);
    // the signed fields are the credential: no bearer token goes to S3
    s3.forEach(([, init]) => expect(init?.headers).toBeUndefined());
    // file goes last, after the policy fields
    s3.forEach(([, init]) => expect([...(init?.body as FormData).keys()].at(-1)).toBe("file"));

    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/photos/p1/complete");
  });

  it.each([
    ["S3 refuses the post", { s3: 403 }, "Upload to storage failed (403)"],
    ["complete finds a variant missing", { complete: 409 }, "upload not finished: missing thumb"],
  ])("fails when %s", async (_label, fail, message) => {
    route(fail);
    await expect(
      uploadPhoto("a", file(), { getToken, prepare, fetchImpl: fetchMock }),
    ).rejects.toThrow(message);
  });

  it("fails without a token", async () => {
    route();
    getToken.mockResolvedValueOnce(null);
    await expect(
      uploadPhoto("a", file(), { getToken, prepare, fetchImpl: fetchMock }),
    ).rejects.toThrow("signed out");
  });
});

describe("uploadAll", () => {
  it("keeps going past a bad file and reports results in input order", async () => {
    route();
    prepare.mockImplementation(async (f: File) => {
      if (f.name === "bad.heic") throw new Error("This browser can't open bad.heic");
      return prepared;
    });
    const files = [file("1.jpg"), file("bad.heic"), file("3.jpg"), file("4.jpg")];
    const onDone = vi.fn();
    const results = await uploadAll(
      "a",
      files,
      { getToken, prepare, fetchImpl: fetchMock },
      onDone,
    );

    expect(results.map((r) => r.file.name)).toEqual(["1.jpg", "bad.heic", "3.jpg", "4.jpg"]);
    expect(results.map((r) => Boolean(r.photo))).toEqual([true, false, true, true]);
    expect(results[1].error).toBe("This browser can't open bad.heic");
    expect(onDone.mock.calls.map(([, finished]) => finished)).toEqual([1, 2, 3, 4]);
  });

  it("does nothing for no files", async () => {
    expect(await uploadAll("a", [], { getToken, prepare, fetchImpl: fetchMock })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
