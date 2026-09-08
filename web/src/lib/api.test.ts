import { describe, expect, it, vi } from "vitest";

import {
  ApiError,
  clampDuration,
  type Comment,
  DEFAULT_DURATION_S,
  etchClear,
  etchMove,
  formatDuration,
  getEtchState,
  listComments,
  listMessages,
  type Message,
  postComment,
  sendMessage,
} from "./api";

const message: Message = {
  id: 1,
  text: "hi",
  color: "#FF8C00",
  duration_s: 10,
  status: "sent",
  error: null,
  sender_name: "Jasper",
  created_at: "2026-09-06T12:00:00Z",
};

function fakeFetch(status: number, body: unknown) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
}

describe("sendMessage", () => {
  it("returns the created message on 202 and sends the bearer token", async () => {
    const fetchImpl = fakeFetch(202, message);
    const result = await sendMessage(
      "tok",
      { text: "hi", color: "#FF8C00", duration_s: 10 },
      fetchImpl,
    );

    expect(result).toEqual(message);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/messages");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer tok",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      text: "hi",
      color: "#FF8C00",
      duration_s: 10,
    });
  });

  it.each([
    [401, { detail: "Missing bearer token" }, "Missing bearer token"],
    [422, { detail: [{ msg: "text too long" }, { msg: "bad color" }] }, "text too long; bad color"],
    [429, { detail: "Slow down" }, "Slow down"],
    [502, { detail: "Board unreachable" }, "Board unreachable"],
    [500, "not json at all", "Request failed (500)"],
  ])("throws ApiError with detail on %i", async (status, body, expected) => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
    );

    const promise = sendMessage("tok", { text: "hi", color: null, duration_s: null }, fetchImpl);
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({ status, message: expected });
  });
});

describe("listMessages", () => {
  it("unwraps the messages array and passes limit", async () => {
    const fetchImpl = fakeFetch(200, { messages: [message] });
    await expect(listMessages("tok", 5, fetchImpl)).resolves.toEqual([message]);
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/messages?limit=5");
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it.each([
    [401, "Invalid token"],
    [502, "Upstream down"],
  ])("throws ApiError on %i", async (status, detail) => {
    const fetchImpl = fakeFetch(status, { detail });
    await expect(listMessages("tok", 20, fetchImpl)).rejects.toMatchObject({
      status,
      message: detail,
    });
  });
});

describe("clampDuration", () => {
  it.each([
    [10, 10],
    [1, 1],
    [60, 60],
    [0, 1],
    [-4, 1],
    [61, 60],
    [99999, 60],
    [12.6, 13],
    [Number.NaN, DEFAULT_DURATION_S],
    [Number.POSITIVE_INFINITY, DEFAULT_DURATION_S],
  ])("clamps %s to %i", (input, expected) => {
    expect(clampDuration(input)).toBe(expected);
  });
});

describe("formatDuration", () => {
  it.each([
    [5, "5s"],
    [45, "45s"],
    [60, "1m"],
    [300, "5m"],
    [120, "2m"],
    [90, "90s"],
  ])("formats %i as %s", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});

const comment: Comment = {
  id: 7,
  post_slug: "hello-world",
  color: "#e0281e",
  text: "first",
  created_at: "2026-09-06T12:00:00Z",
  expires_at: "2026-09-13T12:00:00Z",
};

describe("listComments", () => {
  it("fetches the post's comments without any auth header", async () => {
    const fetchImpl = fakeFetch(200, { comments: [comment] });
    const result = await listComments("hello-world", fetchImpl);

    expect(result).toEqual([comment]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/chatroom/hello-world/comments");
    expect(init?.method).toBe("GET");
    expect(init?.headers).not.toHaveProperty("Authorization");
  });

  it("url-encodes the slug", async () => {
    const fetchImpl = fakeFetch(200, { comments: [] });
    await listComments("a b/c", fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/chatroom/a%20b%2Fc/comments");
  });
});

describe("postComment", () => {
  it("posts text and colour and returns the created comment", async () => {
    const fetchImpl = fakeFetch(201, comment);
    const result = await postComment("hello-world", { text: "first", color: "#e0281e" }, fetchImpl);

    expect(result).toEqual(comment);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/chatroom/hello-world/comments");
    expect(init?.method).toBe("POST");
    expect(init?.headers).not.toHaveProperty("Authorization");
    expect(JSON.parse(String(init?.body))).toEqual({ text: "first", color: "#e0281e" });
  });

  it.each([
    [422, { detail: [{ msg: "text must not be empty" }] }, "text must not be empty"],
    [503, { detail: "DATABASE_URL is not configured" }, "DATABASE_URL is not configured"],
    [500, "nope", "Request failed (500)"],
  ])("throws ApiError with detail on %i", async (status, body, expected) => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
    );
    await expect(postComment("x", { text: "hi", color: "#000000" }, fetchImpl)).rejects.toThrow(
      expected,
    );
  });
});

const etchState = { w: 128, h: 32, x: 64, y: 16, lit: 1, pixels_b64: "AAA=" };

describe("getEtchState", () => {
  it("returns the sketch state with the bearer token", async () => {
    const fetchImpl = fakeFetch(200, etchState);
    await expect(getEtchState("tok", fetchImpl)).resolves.toEqual(etchState);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/etch");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("throws ApiError when the Pi is unreachable", async () => {
    const fetchImpl = fakeFetch(502, { detail: "ConnectError: nope" });
    await expect(getEtchState("tok", fetchImpl)).rejects.toMatchObject({
      status: 502,
      message: "ConnectError: nope",
    });
  });
});

describe("etchMove", () => {
  it("posts the nudge and returns the cursor", async () => {
    const fetchImpl = fakeFetch(200, { x: 68, y: 16 });
    await expect(etchMove("tok", 4, 0, fetchImpl)).resolves.toEqual({ x: 68, y: 16 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/etch/move");
    expect(JSON.parse(String(init?.body))).toEqual({ dx: 4, dy: 0 });
  });
});

describe("etchClear", () => {
  it("clears and returns the stylus position", async () => {
    const fetchImpl = fakeFetch(200, { cleared: true, x: 68, y: 16 });
    await expect(etchClear("tok", fetchImpl)).resolves.toEqual({ cleared: true, x: 68, y: 16 });
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/etch/clear");
  });
});
