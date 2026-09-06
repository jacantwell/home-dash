import { describe, expect, it, vi } from "vitest";

import {
  ApiError,
  clampDuration,
  DEFAULT_DURATION_S,
  formatDuration,
  listMessages,
  type Message,
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
    [300, 300],
    [0, 1],
    [-4, 1],
    [301, 300],
    [99999, 300],
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
    [90, "90s"],
  ])("formats %i as %s", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});
