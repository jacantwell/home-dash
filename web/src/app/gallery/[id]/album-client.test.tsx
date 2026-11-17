import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Album, Photo, Placement } from "@/lib/api";
import type { PreparedImage } from "@/lib/images";

import { AlbumView } from "./album-client";
import type { SceneEvents } from "./space-scene";

// jsdom has no WebGL: stand in for the scene and drive it through its callbacks
const scene = vi.hoisted(() => ({
  events: null as SceneEvents | null,
  sync: vi.fn(),
  eye: () => ({ x: 0, y: 300, z: 1000 }),
  viewYaw: () => 0,
}));
vi.mock("./space-scene", () => ({
  SpaceScene: class {
    sync = scene.sync;
    eye = scene.eye;
    viewYaw = scene.viewYaw;
    dispose = vi.fn();
    constructor(_el: HTMLElement, events: SceneEvents) {
      scene.events = events;
    }
  },
}));

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

const placed = (over: Partial<Placement> = {}): Placement => ({
  x: 500,
  y: 400,
  z: -200,
  yaw: 0,
  r: 0,
  s: 1,
  ...over,
});

describe("AlbumView canvas", () => {
  async function openCanvas(a = album()) {
    await renderAlbum(a);
    await userEvent.click(screen.getByRole("radio", { name: "Canvas" }));
    await waitFor(() => expect(scene.sync).toHaveBeenCalled());
  }

  beforeEach(() => {
    scene.events = null;
    scene.sync.mockReset();
  });

  it("puts every photo in the space, saved placements first", async () => {
    await openCanvas(album({ layout: { p1: placed({ yaw: 30, r: 12, s: 1.5 }) } }));
    const card = screen.getByTestId("card-p1");
    expect(card).toHaveAttribute("data-x", "500");
    expect(card).toHaveAttribute("data-yaw", "30");
    // new photos land in front of what's already placed
    expect(Number(screen.getByTestId("card-p2").getAttribute("data-z"))).toBeGreaterThan(-200);
    const [photos, layout] = scene.sync.mock.lastCall!;
    expect(photos).toHaveLength(2);
    expect(Object.keys(layout).sort()).toEqual(["p1", "p2"]);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("moves a photo with the keyboard, then saves the layout", async () => {
    await openCanvas(album({ layout: { p1: placed() } }));
    const card = screen.getByTestId("card-p1");
    card.focus();
    fireEvent.keyDown(card, { key: "ArrowRight" });
    fireEvent.keyDown(card, { key: "ArrowUp" });
    fireEvent.keyDown(card, { key: "." });
    expect(card).toHaveAttribute("data-x", "520");
    expect(card).toHaveAttribute("data-z", "-220");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    fetchMock.mockImplementationOnce(async (_url, init) =>
      json(200, { layout: JSON.parse(String(init?.body)).items }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument());

    const [url, init] = calls("PUT")[0];
    expect(url).toBe("/api/albums/a1/layout");
    const items = JSON.parse(String(init?.body)).items;
    expect(items.p1).toEqual(placed({ x: 520, z: -220, yaw: 5 }));
    expect(Object.keys(items).sort()).toEqual(["p1", "p2"]);
  });

  it("follows a drag in the scene", async () => {
    await openCanvas(album({ layout: { p1: placed() } }));
    act(() => {
      scene.events!.onSelect("p1");
      scene.events!.onMove("p1", placed({ x: 0, y: 900, z: -1500 }));
    });
    const card = screen.getByTestId("card-p1");
    expect(card).toHaveAttribute("data-z", "-1500");
    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it.each([
    ["Turn right", { yaw: 15 }],
    ["Turn left", { yaw: -15 }],
    ["Bigger", { s: 1.15 }],
    // camera at (0, 300, 1000), photo at (500, 400, -200)
    ["Face me", { yaw: -22.6 }],
  ])("%s edits the selected photo", async (label, expected) => {
    await openCanvas(album({ layout: { p1: placed() } }));
    act(() => scene.events!.onSelect("p1"));
    await userEvent.click(screen.getByRole("button", { name: label }));
    const card = screen.getByTestId("card-p1");
    for (const [k, v] of Object.entries(expected)) {
      expect(Number(card.getAttribute(`data-${k}`))).toBeCloseTo(v);
    }
  });

  it.each([
    ["Enter on a photo", () => fireEvent.keyDown(screen.getByTestId("card-p2"), { key: "Enter" })],
    ["a double-click in the scene", () => act(() => scene.events!.onOpen("p2"))],
  ])("opens the viewer with %s", async (_, open) => {
    await openCanvas();
    open();
    expect(screen.getByRole("dialog", { name: "Picture viewer" })).toHaveTextContent(
      "Photo 2 of 2",
    );
  });
});
