import { useAuth } from "@clerk/nextjs";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "@/lib/api";

import { BoardClient } from "./board-client";

const existing: Message = {
  id: 1,
  text: "old news",
  color: "#00FF00",
  status: "sent",
  error: null,
  sender_name: "Jasper",
  created_at: new Date(Date.now() - 3_600_000).toISOString(),
};

const failed: Message = {
  ...existing,
  id: 2,
  text: "never made it",
  color: null,
  status: "failed",
  error: "board timed out",
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

const fetchMock = vi.fn<typeof fetch>();
const getToken = vi.fn(async () => "test-token");

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(useAuth).mockReturnValue({
    isLoaded: true,
    isSignedIn: true,
    userId: "user_test",
    getToken,
  } as unknown as ReturnType<typeof useAuth>);
  fetchMock.mockReset();
  getToken.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BoardClient", () => {
  it("loads recent messages with the bearer token and shows status pills", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { messages: [existing, failed] }));
    render(<BoardClient />);

    expect(await screen.findByText("old news")).toBeInTheDocument();
    expect(screen.getByText("never made it")).toBeInTheDocument();
    expect(screen.getByText("sent")).toBeInTheDocument();
    expect(screen.getByText("failed")).toHaveAttribute("title", "board timed out");
    expect(screen.getAllByText(/Jasper/)).toHaveLength(2);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/messages?limit=20");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer test-token" });
  });

  it("submits a message and prepends the response", async () => {
    const user = userEvent.setup();
    const created: Message = { ...existing, id: 3, text: "dinner", color: "#FF8C00" };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { messages: [existing] }))
      .mockResolvedValueOnce(jsonResponse(202, created));
    render(<BoardClient />);
    await screen.findByText("old news");

    const input = screen.getByLabelText("Message");
    await user.type(input, "dinner");
    expect(screen.getByText("6/200")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /send to board/i }));

    await waitFor(() => expect(screen.getByText("dinner")).toBeInTheDocument());
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("dinner");
    expect(items[1]).toHaveTextContent("old news");
    expect(input).toHaveValue("");

    const [, init] = fetchMock.mock.calls[1];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ text: "dinner", color: "#FF8C00" });
  });

  it("sends color null when board default is ticked", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { messages: [] }))
      .mockResolvedValueOnce(jsonResponse(202, { ...existing, id: 4, text: "plain", color: null }));
    render(<BoardClient />);
    await screen.findByText(/nothing yet/i);

    await user.click(screen.getByLabelText(/use board default/i));
    await user.type(screen.getByLabelText("Message"), "plain");
    await user.click(screen.getByRole("button", { name: /send to board/i }));

    await screen.findByText("plain");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      text: "plain",
      color: null,
    });
  });

  it.each([
    [401, { detail: "Token expired" }, "Token expired"],
    [422, { detail: [{ msg: "text too long" }] }, "text too long"],
    [502, { detail: "Board unreachable" }, "Board unreachable"],
  ])("shows the detail when the POST fails with %i", async (status, body, expected) => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { messages: [] }))
      .mockResolvedValueOnce(jsonResponse(status, body));
    render(<BoardClient />);
    await screen.findByText(/nothing yet/i);

    await user.type(screen.getByLabelText("Message"), "yo");
    await user.click(screen.getByRole("button", { name: /send to board/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("shows an error when loading fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { detail: "Missing token" }));
    render(<BoardClient />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Missing token");
  });
});
