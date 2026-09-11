import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Sprite, SPRITE_CELLS } from "@/lib/api";

import { SpriteMaker } from "./sprites-client";

const existing: Sprite = {
  id: 1,
  name: "smiley",
  author_name: "Jasper",
  w: 16,
  h: 16,
  pixels: "b" + ".".repeat(SPRITE_CELLS - 1),
  created_at: new Date(Date.now() - 3_600_000).toISOString(),
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

const fetchMock = vi.fn<typeof fetch>();
const getToken = vi.fn(async () => "test-token");

function cell(x: number, y: number) {
  return screen.getByRole("gridcell", { name: `cell ${x},${y}` });
}

function paint(x: number, y: number) {
  fireEvent.pointerDown(cell(x, y), { button: 0 });
  fireEvent.pointerUp(window);
}

function renderMaker(signedIn = true) {
  return render(<SpriteMaker signedIn={signedIn} getToken={getToken} />);
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  getToken.mockClear();
  fetchMock.mockResolvedValueOnce(jsonResponse(200, { sprites: [existing] }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SpriteMaker", () => {
  it("loads the catalog anonymously and shows each sprite", async () => {
    renderMaker();
    const catalog = await screen.findByRole("list", { name: "Catalog" });
    expect(within(catalog).getByRole("img", { name: "smiley" })).toBeInTheDocument();
    expect(catalog).toHaveTextContent(":smiley:");
    expect(catalog).toHaveTextContent("Jasper");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/sprites?limit=200");
    expect(init?.headers).not.toHaveProperty("Authorization");
  });

  it("paints with the pencil in the selected colour", async () => {
    renderMaker();
    await screen.findByRole("list", { name: "Catalog" });
    await userEvent.click(screen.getByRole("radio", { name: "#ff0000" }));
    paint(3, 4);
    expect(cell(3, 4)).toHaveAttribute("data-cell", "a");
    expect(cell(4, 4)).toHaveAttribute("data-cell", ".");
    expect(screen.getByText(`1/${SPRITE_CELLS} px`)).toBeInTheDocument();
  });

  it("paints a stroke while dragging across cells", async () => {
    renderMaker();
    await screen.findByRole("list", { name: "Catalog" });
    fireEvent.pointerDown(cell(0, 0), { button: 0 });
    fireEvent.pointerEnter(cell(1, 0));
    fireEvent.pointerEnter(cell(2, 0));
    fireEvent.pointerUp(window);
    fireEvent.pointerEnter(cell(3, 0));
    expect(cell(0, 0)).toHaveAttribute("data-cell", "0");
    expect(cell(1, 0)).toHaveAttribute("data-cell", "0");
    expect(cell(2, 0)).toHaveAttribute("data-cell", "0");
    expect(cell(3, 0)).toHaveAttribute("data-cell", ".");
  });

  it.each([
    ["Eraser", "."],
    ["Fill", "0"],
  ])("%s tool sets the cell to %s", async (label, expected) => {
    renderMaker();
    await screen.findByRole("list", { name: "Catalog" });
    paint(5, 5);
    await userEvent.click(screen.getByRole("button", { name: label }));
    paint(5, 5);
    expect(cell(5, 5)).toHaveAttribute("data-cell", expected);
  });

  it("fill floods the contiguous transparent region only", async () => {
    renderMaker();
    await screen.findByRole("list", { name: "Catalog" });
    // wall off the top-left cell, then fill outside it
    paint(1, 0);
    paint(0, 1);
    paint(1, 1);
    await userEvent.click(screen.getByRole("radio", { name: "#0000ff" }));
    await userEvent.click(screen.getByRole("button", { name: "Fill" }));
    paint(8, 8);
    expect(cell(8, 8)).toHaveAttribute("data-cell", "e");
    expect(cell(15, 15)).toHaveAttribute("data-cell", "e");
    expect(cell(0, 0)).toHaveAttribute("data-cell", ".");
    expect(cell(1, 1)).toHaveAttribute("data-cell", "0");
  });

  it("clear wipes the canvas", async () => {
    renderMaker();
    await screen.findByRole("list", { name: "Catalog" });
    paint(2, 2);
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(cell(2, 2)).toHaveAttribute("data-cell", ".");
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
  });

  it.each([
    ["empty name, drawn", "", true, false],
    ["good name, nothing drawn", "cat", false, false],
    ["good name, drawn", "cat", true, true],
    ["bad name, drawn", "cat_", true, false],
  ])("save enabled: %s", async (_label, name, draw, enabled) => {
    renderMaker();
    await screen.findByRole("list", { name: "Catalog" });
    if (name) await userEvent.type(screen.getByRole("textbox", { name: "Name" }), name);
    if (draw) paint(0, 0);
    const save = screen.getByRole("button", { name: "Save" });
    if (enabled) expect(save).toBeEnabled();
    else expect(save).toBeDisabled();
  });

  it.each([
    ["Smiley Face", "smiley_face"],
    ["cat-2", "cat_2"],
    ["x".repeat(40), "x".repeat(32)],
  ])("normalises the typed name %s to %s", async (typed, expected) => {
    renderMaker();
    await screen.findByRole("list", { name: "Catalog" });
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), typed);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(expected);
  });

  it("saves with the bearer token and prepends the sprite to the catalog", async () => {
    const created: Sprite = { ...existing, id: 2, name: "dot", pixels: "0" + ".".repeat(255) };
    fetchMock.mockResolvedValueOnce(jsonResponse(201, created));
    renderMaker();
    await screen.findByRole("list", { name: "Catalog" });
    paint(0, 0);
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "dot");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Saved :dot:");
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/sprites");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer test-token" });
    expect(JSON.parse(String(init?.body))).toEqual({ name: "dot", pixels: created.pixels });
    const names = within(screen.getByRole("list", { name: "Catalog" })).getAllByRole("img");
    expect(names.map((n) => n.getAttribute("aria-label"))).toEqual(["dot", "smiley"]);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("");
  });

  it("shows the API error on a 409 and keeps the drawing", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { detail: "a sprite called 'dot' already exists" }),
    );
    renderMaker();
    await screen.findByRole("list", { name: "Catalog" });
    paint(0, 0);
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "dot");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("a sprite called 'dot' already exists");
    await userEvent.click(within(alert).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(cell(0, 0)).toHaveAttribute("data-cell", "0");
  });

  it("asks signed-out users to log on instead of posting", async () => {
    renderMaker(false);
    await screen.findByRole("list", { name: "Catalog" });
    paint(0, 0);
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "dot");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("dialog", { name: "Log On to Sprite Maker" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a catalog sprite onto the canvas", async () => {
    renderMaker();
    const catalog = await screen.findByRole("list", { name: "Catalog" });
    await userEvent.click(within(catalog).getByRole("button"));
    expect(cell(0, 0)).toHaveAttribute("data-cell", "b");
  });

  it("shows the load error when the catalog fails", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(503, { detail: "DATABASE_URL is not configured" }),
    );
    renderMaker();
    expect(await screen.findByRole("alert")).toHaveTextContent("DATABASE_URL is not configured");
  });
});
