import { useAuth } from "@clerk/nextjs";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_DURATION_S, type Message } from "@/lib/api";

import { BoardClient } from "./board-client";

const existing: Message = {
  id: 1,
  text: "old news",
  color: "#00FF00",
  duration_s: 10,
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

// Body rows of the Sent Items grid; the header row is excluded.
function messageRows() {
  return screen.queryAllByRole("row").filter((row) => row.closest("tbody"));
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
  it("loads recent messages with the bearer token and shows status", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { messages: [existing, failed] }));
    render(<BoardClient />);

    await screen.findAllByText("old news");
    expect(messageRows()).toHaveLength(2);
    expect(messageRows()[0]).toHaveTextContent("Jasper");
    expect(screen.getByText("never made it")).toBeInTheDocument();
    expect(screen.getByText("sent")).toBeInTheDocument();
    expect(screen.getByText("failed")).toHaveAttribute("title", "board timed out");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/messages?limit=20");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer test-token" });
  });

  it("selects the newest message by default and previews it on the board", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { messages: [existing, failed] }));
    render(<BoardClient />);

    await screen.findAllByText("old news");
    expect(messageRows()[0]).toHaveAttribute("aria-selected", "true");
    const led = screen.getAllByText("old news").find((el) => el.classList.contains("led"));
    expect(led).toHaveStyle({ color: "#00FF00" });
  });

  it("shows the delivery error when a failed message is selected", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { messages: [existing, failed] }));
    render(<BoardClient />);

    await screen.findAllByText("old news");
    await user.click(screen.getByText("never made it"));
    expect(messageRows()[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/delivery failed: board timed out/i)).toBeInTheDocument();
  });

  it("submits a message, prepends it and selects it", async () => {
    const user = userEvent.setup();
    const created: Message = { ...existing, id: 3, text: "dinner", color: "#FF8C00" };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { messages: [existing] }))
      .mockResolvedValueOnce(jsonResponse(202, created));
    render(<BoardClient />);
    await screen.findAllByText("old news");

    const input = screen.getByLabelText("Message");
    await user.type(input, "dinner");
    expect(screen.getByText("6/200")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(messageRows()[0]).toHaveTextContent("dinner"));
    expect(messageRows()[0]).toHaveAttribute("aria-selected", "true");
    expect(messageRows()[1]).toHaveTextContent("old news");
    expect(input).toHaveValue("");

    const [, init] = fetchMock.mock.calls[1];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      text: "dinner",
      color: "#FF8C00",
      duration_s: 10,
    });
  });

  it("shows the sending dialog while the request is in flight", async () => {
    const user = userEvent.setup();
    let resolvePost: (r: Response) => void = () => {};
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { messages: [] }))
      .mockImplementationOnce(() => new Promise((res) => (resolvePost = res)));
    render(<BoardClient />);
    await screen.findByText(/no items in this view/i);

    await user.type(screen.getByLabelText("Message"), "brb");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    expect(screen.getByRole("status")).toHaveTextContent(/sending message 1 of 1/i);
    resolvePost(jsonResponse(202, { ...existing, id: 5, text: "brb" }));
    await waitFor(() => expect(messageRows()).toHaveLength(1));
  });

  it("sends color null when board default is ticked", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { messages: [] }))
      .mockResolvedValueOnce(jsonResponse(202, { ...existing, id: 4, text: "plain", color: null }));
    render(<BoardClient />);
    await screen.findByText(/no items in this view/i);

    await user.click(screen.getByLabelText(/use board default/i));
    await user.type(screen.getByLabelText("Message"), "plain");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await screen.findAllByText("plain");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      text: "plain",
      color: null,
      duration_s: 10,
    });
  });

  it("offers nothing longer than a minute", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { messages: [] }));
    render(<BoardClient />);
    await screen.findByText(/no items in this view/i);

    const values = within(screen.getByLabelText("Duration"))
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value)
      .filter((v) => v !== "")
      .map(Number);
    expect(values.length).toBeGreaterThan(0);
    expect(Math.max(...values)).toBe(MAX_DURATION_S);
  });

  it.each([
    ["30s", 30],
    ["1m", 60],
    ["board default", null],
  ])("sends the chosen duration (%s)", async (label, expected) => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { messages: [] }))
      .mockResolvedValueOnce(jsonResponse(202, { ...existing, id: 6, text: "later" }));
    render(<BoardClient />);
    await screen.findByText(/no items in this view/i);

    await user.selectOptions(screen.getByLabelText("Duration"), label);
    await user.type(screen.getByLabelText("Message"), "later");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await screen.findAllByText("later");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      duration_s: expected,
    });
  });

  it.each([
    [401, { detail: "Token expired" }, "Token expired"],
    [422, { detail: [{ msg: "text too long" }] }, "text too long"],
    [502, { detail: "Board unreachable" }, "Board unreachable"],
  ])("shows an error box when the POST fails with %i", async (status, body, expected) => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { messages: [] }))
      .mockResolvedValueOnce(jsonResponse(status, body));
    render(<BoardClient />);
    await screen.findByText(/no items in this view/i);

    await user.type(screen.getByLabelText("Message"), "yo");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
    expect(messageRows()).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an error box when loading fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { detail: "Missing token" }));
    render(<BoardClient />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Missing token");
  });

  it("reloads the list from the toolbar", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { messages: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { messages: [existing] }));
    render(<BoardClient />);
    await screen.findByText(/no items in this view/i);

    await user.click(screen.getByRole("button", { name: /refresh/i }));
    await screen.findAllByText("old news");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
