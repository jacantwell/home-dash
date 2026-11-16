import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Album, Photo } from "@/lib/api";
import type { PreparedImage } from "@/lib/images";

import { AlbumView } from "./album-client";
import { keyEdit } from "./canvas-board";

const photo = (id: string, over: Partial<Photo> = {}): Photo => ({
  id,
  album_id: "a1",
  uploader_name: "Jasper",
  content_type: "image/jpeg",
  bytes: 2_500_000,
  width: 4032,
  height: 3024,
  thumb_url: `https://cdn.test/${id}/thumb.jpg?sig`,
  display_url: `https://cdn.test/${id}/display.jpg?sig`,
  original_url: `https://cdn.test/${id}/original.jpg?sig`,
  deletable: true,
  created_at: "2026-11-01T00:00:00Z",
  ...over,
});

const album = (over: Partial<Album> = {}): Album => ({
  id: "a1",
  title: "Birthday",
  created_by_name: "Jasper",
  photo_count: 2,
  cover_url: null,
  deletable: true,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
  layout: {},
  photos: [photo("p1"), photo("p2", { deletable: false, uploader_name: "Sam" })],
  ...over,
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const fetchMock = vi.fn<typeof fetch>();
const getToken = vi.fn(async () => "tok");
const onDeleted = vi.fn();

function calls(method: string) {
  return fetchMock.mock.calls.filter(([, init]) => (init?.method ?? "GET") === method);
}

async function renderAlbum(a: Album = album(), extra = {}) {
  fetchMock.mockResolvedValueOnce(json(200, a));
  render(<AlbumView albumId="a1" getToken={getToken} onDeleted={onDeleted} {...extra} />);
  await screen.findByRole("heading", { name: a.title });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  onDeleted.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

describe("AlbumView grid + lightbox", () => {
  it("shows thumbnails and the count", async () => {
    await renderAlbum();
    const grid = screen.getByRole("list", { name: "Photos" });
    expect(
      within(grid)
        .getAllByRole("img")
        .map((i) => i.getAttribute("src")),
    ).toEqual(["https://cdn.test/p1/thumb.jpg?sig", "https://cdn.test/p2/thumb.jpg?sig"]);
    expect(screen.getByText("2 photos")).toBeInTheDocument();
  });

  it("says when the album is empty", async () => {
    await renderAlbum(album({ photos: [], photo_count: 0 }));
    expect(screen.getByText(/Empty album/)).toBeInTheDocument();
  });

  it.each([
    ["ArrowRight", 0, "Photo 2 of 2 - Picture Viewer"],
    ["ArrowLeft", 1, "Photo 1 of 2 - Picture Viewer"],
    ["ArrowLeft", 0, "Photo 1 of 2 - Picture Viewer"],
  ])("%s from photo %i shows %s", async (key, start, title) => {
    await renderAlbum();
    await userEvent.click(screen.getAllByRole("button", { name: /^Photo \d by/ })[start]);
    fireEvent.keyDown(window, { key });
    expect(screen.getByRole("dialog", { name: "Picture viewer" })).toHaveTextContent(title);
  });

  it("shows the display rendition and links the original", async () => {
    await renderAlbum();
    await userEvent.click(screen.getAllByRole("button", { name: /^Photo \d by/ })[0]);
    const viewer = screen.getByRole("dialog", { name: "Picture viewer" });
    expect(within(viewer).getByRole("img")).toHaveAttribute(
      "src",
      "https://cdn.test/p1/display.jpg?sig",
    );
    expect(within(viewer).getByRole("link", { name: "Original" })).toHaveAttribute(
      "href",
      "https://cdn.test/p1/original.jpg?sig",
    );
    expect(viewer).toHaveTextContent("4032×3024 · 2.4 MB");
  });

  it("closes on Escape", async () => {
    await renderAlbum();
    await userEvent.click(screen.getAllByRole("button", { name: /^Photo \d by/ })[0]);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Picture viewer" })).not.toBeInTheDocument();
  });

  it.each([
    [0, true],
    [1, false],
  ])("photo %i offers delete: %s", async (index, deletable) => {
    await renderAlbum();
    await userEvent.click(screen.getAllByRole("button", { name: /^Photo \d by/ })[index]);
    const viewer = screen.getByRole("dialog", { name: "Picture viewer" });
    expect(within(viewer).queryByRole("button", { name: "Delete" }) !== null).toBe(deletable);
  });

  it("deletes a photo after confirming", async () => {
    await renderAlbum();
    await userEvent.click(screen.getAllByRole("button", { name: /^Photo \d by/ })[0]);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Really delete?" }));

    await screen.findByText("1 photo");
    expect(calls("DELETE")[0][0]).toBe("/api/photos/p1");
    // the viewer moves on to what's left
    expect(screen.getByRole("dialog", { name: "Picture viewer" })).toHaveTextContent(
      "Photo 1 of 1",
    );
  });
});

describe("AlbumView album actions", () => {
  it.each([
    [true, true],
    [false, false],
  ])("deletable=%s shows Delete album: %s", async (deletable, shown) => {
    await renderAlbum(album({ deletable }));
    expect(screen.queryByRole("button", { name: "Delete album" }) !== null).toBe(shown);
  });

  it("deletes the album after confirming", async () => {
    await renderAlbum();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await userEvent.click(screen.getByRole("button", { name: "Delete album" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(calls("DELETE")[0][0]).toBe("/api/albums/a1");
  });

  it("uploads chosen files and adds them to the grid", async () => {
    const prepared: PreparedImage = {
      width: 10,
      height: 10,
      contentType: "image/jpeg",
      display: new Blob(["d"]),
      thumb: new Blob(["t"]),
    };
    await renderAlbum(album({ photos: [] }), { uploadDeps: { prepare: async () => prepared } });
    const post = { url: "https://s3.test/", fields: {} };
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/photos")) {
        return json(201, {
          photo_id: "new",
          uploads: { original: post, display: post, thumb: post },
        });
      }
      if (url.startsWith("https://s3.test")) return new Response(null, { status: 204 });
      return json(200, photo("new"));
    });

    await userEvent.upload(screen.getByLabelText("Choose photos"), [
      new File(["x"], "a.jpg", { type: "image/jpeg" }),
    ]);

    await screen.findByText("1 photo");
    expect(screen.getByRole("list", { name: "Photos" })).toBeInTheDocument();
  });
});

describe("AlbumView canvas", () => {
  async function openCanvas(a = album()) {
    await renderAlbum(a);
    await userEvent.click(screen.getByRole("radio", { name: "Canvas" }));
  }

  it("puts every photo on the board, saved placements first", async () => {
    await openCanvas(album({ layout: { p1: { x: 500, y: 400, r: 12, s: 1.5, z: 3 } } }));
    const card = screen.getByTestId("card-p1");
    expect(card).toHaveAttribute("data-x", "500");
    expect(card).toHaveAttribute("data-r", "12");
    expect(screen.getByTestId("card-p2")).toHaveAttribute("data-z", "4");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("moves a photo with the keyboard, then saves the layout", async () => {
    await openCanvas(album({ layout: { p1: { x: 500, y: 400, r: 0, s: 1, z: 9 } } }));
    const card = screen.getByTestId("card-p1");
    card.focus();
    fireEvent.keyDown(card, { key: "ArrowRight" });
    fireEvent.keyDown(card, { key: "]" });
    expect(card).toHaveAttribute("data-x", "510");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    fetchMock.mockImplementationOnce(async (_url, init) =>
      json(200, { layout: JSON.parse(String(init?.body)).items }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument());

    const [url, init] = calls("PUT")[0];
    expect(url).toBe("/api/albums/a1/layout");
    const items = JSON.parse(String(init?.body)).items;
    expect(items.p1).toMatchObject({ x: 510, y: 400, r: 5, s: 1 });
    expect(Object.keys(items).sort()).toEqual(["p1", "p2"]);
  });

  it("drags a photo by the pointer", async () => {
    await openCanvas(album({ layout: { p1: { x: 500, y: 400, r: 0, s: 1, z: 9 } } }));
    const card = screen.getByTestId("card-p1");
    fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    // under the tap slop: nothing moves
    fireEvent.pointerMove(card, { clientX: 12, clientY: 10, pointerId: 1 });
    expect(card).toHaveAttribute("data-x", "500");
    // default zoom 0.35: 35px on screen is 100 board units
    fireEvent.pointerMove(card, { clientX: 45, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(card, { pointerId: 1 });
    expect(Number(card.getAttribute("data-x"))).toBeCloseTo(600);
    expect(card).toHaveAttribute("aria-pressed", "true");
  });

  it("opens the viewer from the board with Enter", async () => {
    await openCanvas();
    fireEvent.keyDown(screen.getByTestId("card-p2"), { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "Picture viewer" })).toHaveTextContent(
      "Photo 2 of 2",
    );
  });
});

describe("keyEdit", () => {
  const p = { x: 100, y: 100, r: 0, s: 1, z: 0 };
  it.each([
    ["ArrowLeft", false, { x: 90 }],
    ["ArrowRight", true, { x: 150 }],
    ["ArrowUp", false, { y: 90 }],
    ["ArrowDown", true, { y: 150 }],
    ["[", false, { r: -5 }],
    ["]", true, { r: 15 }],
    ["+", false, { s: 1.05 }],
    ["=", true, { s: 1.25 }],
    ["-", true, { s: 0.8 }],
  ])("%s (shift=%s)", (key, big, expected) => {
    expect(keyEdit(p, key, big)).toMatchObject(expected);
  });

  it("ignores other keys", () => {
    expect(keyEdit(p, "a", false)).toBeNull();
  });
});
