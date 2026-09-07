import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Comment, MAX_COMMENT_LINES } from "@/lib/api";

import { Comments, PEN_COLORS, PEN_STORAGE_KEY } from "./comments";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const existing: Comment = {
  id: 1,
  post_slug: "hello-world",
  color: "#e0281e",
  text: "first!\nsecond line",
  created_at: new Date(Date.now() - 2 * HOUR).toISOString(),
  expires_at: new Date(Date.now() + 7 * DAY - 2 * HOUR).toISOString(),
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

function notes() {
  return within(screen.getByRole("list", { name: "Replies" })).queryAllByRole("listitem");
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderRoom() {
  return render(<Comments slug="hello-world" room="A" />);
}

describe("Comments", () => {
  it("loads the room's notes anonymously and paints them in their pen colour", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { comments: [existing] }));
    renderRoom();

    const note = (await screen.findAllByText(/first!/))[0].closest("li")!;
    expect(note).toHaveTextContent("anon");
    expect(note.style.getPropertyValue("--pen")).toBe("#e0281e");
    expect(note).toHaveTextContent("2 hours ago");
    expect(note).toHaveTextContent(/fades in 7 days/);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/blog/hello-world/comments");
    expect(init?.headers).not.toHaveProperty("Authorization");
    expect(screen.getByText("1 note(s)")).toBeInTheDocument();
  });

  it("shows an empty room", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { comments: [] }));
    renderRoom();
    expect(await screen.findByText(/nobody has said anything/i)).toBeInTheDocument();
    expect(screen.getByText("0 note(s)")).toBeInTheDocument();
  });

  it("reports a failed load", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { detail: "db is asleep" }));
    renderRoom();
    expect(await screen.findByRole("alert")).toHaveTextContent("db is asleep");
  });

  it("posts a note with the chosen pen and appends it to the log", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { comments: [existing] }));
    renderRoom();
    await screen.findAllByText(/first!/);

    await user.click(screen.getByRole("radio", { name: `Pen ${PEN_COLORS[5]}` }));
    const created: Comment = {
      ...existing,
      id: 2,
      color: PEN_COLORS[5],
      text: "hello",
      created_at: new Date().toISOString(),
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(201, created));

    const pad = screen.getByRole("textbox", { name: "Your note" });
    await user.type(pad, "  hello ");
    await user.click(screen.getByRole("button", { name: "Post note" }));

    await waitFor(() => expect(notes()).toHaveLength(2));
    expect(notes()[1]).toHaveTextContent("hello");
    expect(pad).toHaveValue("");
    const [, init] = fetchMock.mock.calls[1];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ text: "hello", color: PEN_COLORS[5] });
    expect(screen.getByText("2 note(s)")).toBeInTheDocument();
  });

  it("sends on Enter and inserts a newline on Shift+Enter", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { comments: [] }));
    renderRoom();
    await screen.findByText(/nobody/i);
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { ...existing, id: 3, text: "a\nb" }));

    const pad = screen.getByRole("textbox", { name: "Your note" });
    await user.type(pad, "a{Shift>}{Enter}{/Shift}b");
    expect(pad).toHaveValue("a\nb");
    await user.type(pad, "{Enter}");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).text).toBe("a\nb");
  });

  it.each([[""], ["   "]])("does not post %j", async (typed) => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { comments: [] }));
    renderRoom();
    await screen.findByText(/nobody/i);
    if (typed) await user.type(screen.getByRole("textbox", { name: "Your note" }), typed);

    const post = screen.getByRole("button", { name: "Post note" });
    expect(post).toBeEnabled();
    await user.click(post);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("names the form and keeps the pens out of it", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { comments: [] }));
    renderRoom();
    await screen.findByText(/nobody/i);

    const form = screen.getByRole("form", { name: "Reply in Chat Room A" });
    expect(within(form).queryAllByRole("radio")).toHaveLength(0);
    expect(within(form).getByRole("textbox", { name: "Your note" })).toHaveAttribute(
      "name",
      "note",
    );
    expect(screen.getAllByRole("radio")).toHaveLength(PEN_COLORS.length);
  });

  it(`caps the pad at ${MAX_COMMENT_LINES} lines`, async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { comments: [] }));
    renderRoom();
    await screen.findByText(/nobody/i);

    const pad = screen.getByRole("textbox", { name: "Your note" });
    for (let i = 0; i < MAX_COMMENT_LINES + 2; i++) {
      await user.type(pad, `l${i}{Shift>}{Enter}{/Shift}`);
    }
    expect((pad as HTMLTextAreaElement).value.split("\n")).toHaveLength(MAX_COMMENT_LINES);
  });

  it("clears the pad", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { comments: [] }));
    renderRoom();
    await screen.findByText(/nobody/i);

    const pad = screen.getByRole("textbox", { name: "Your note" });
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
    await user.type(pad, "oops");
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(pad).toHaveValue("");
  });

  it("shows the api's error when a post is rejected and keeps the text", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { comments: [] }));
    renderRoom();
    await screen.findByText(/nobody/i);
    fetchMock.mockResolvedValueOnce(jsonResponse(422, { detail: [{ msg: "too long" }] }));

    const pad = screen.getByRole("textbox", { name: "Your note" });
    await user.type(pad, "hi");
    await user.click(screen.getByRole("button", { name: "Post note" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("too long");
    expect(pad).toHaveValue("hi");
    expect(notes().filter((li) => !li.classList.contains("pc-empty"))).toHaveLength(0);
  });

  it("remembers the pen in localStorage and restores it", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async () => jsonResponse(200, { comments: [] }));
    const { unmount } = renderRoom();
    await screen.findByText(/nobody/i);

    await user.click(screen.getByRole("radio", { name: `Pen ${PEN_COLORS[9]}` }));
    expect(localStorage.getItem(PEN_STORAGE_KEY)).toBe(PEN_COLORS[9]);
    unmount();

    renderRoom();
    await screen.findByText(/nobody/i);
    expect(screen.getByRole("radio", { name: `Pen ${PEN_COLORS[9]}` })).toBeChecked();
  });

  it("picks a valid pen when storage holds junk", async () => {
    localStorage.setItem(PEN_STORAGE_KEY, "#badbad");
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { comments: [] }));
    renderRoom();
    await screen.findByText(/nobody/i);
    const checked = screen.getAllByRole("radio").filter((r) => (r as HTMLInputElement).checked);
    expect(checked).toHaveLength(1);
    expect(PEN_COLORS).toContain((checked[0] as HTMLInputElement).value);
  });
});
