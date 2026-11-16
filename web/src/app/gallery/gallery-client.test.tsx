import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AlbumSummary } from "@/lib/api";

import { AlbumBrowser } from "./gallery-client";

const album = (over: Partial<AlbumSummary> = {}): AlbumSummary => ({
  id: "a1",
  title: "Birthday",
  created_by_name: "Jasper",
  photo_count: 3,
  cover_url: "https://cdn.test/albums/a1/p/thumb.jpg?sig",
  deletable: true,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
  ...over,
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const fetchMock = vi.fn<typeof fetch>();
const getToken = vi.fn(async () => "tok");
const onOpen = vi.fn();

function renderBrowser() {
  return render(<AlbumBrowser getToken={getToken} onOpen={onOpen} />);
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  onOpen.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

describe("AlbumBrowser", () => {
  it("lists albums with the bearer token", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { albums: [album()] }));
    renderBrowser();
    const list = await screen.findByRole("list", { name: "Albums" });
    const link = within(list).getByRole("link");
    expect(link).toHaveAttribute("href", "/gallery/a1");
    expect(link).toHaveTextContent("Birthday");
    expect(link).toHaveTextContent("3 photos · Jasper");
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it.each([
    [1, "1 photo"],
    [0, "0 photos"],
  ])("pluralises %i photos", async (count, text) => {
    fetchMock.mockResolvedValueOnce(
      json(200, { albums: [album({ photo_count: count, cover_url: null })] }),
    );
    renderBrowser();
    expect(await screen.findByRole("link")).toHaveTextContent(text);
  });

  it("says so when there are no albums", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { albums: [] }));
    renderBrowser();
    expect(await screen.findByText(/No albums yet/)).toBeInTheDocument();
  });

  it("creates an album and opens it", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { albums: [] }))
      .mockResolvedValueOnce(json(201, album({ id: "new" })));
    renderBrowser();
    await screen.findByText(/No albums yet/);
    await userEvent.click(screen.getByRole("button", { name: "New album" }));
    const create = screen.getByRole("button", { name: "Create" });
    expect(create).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Album name" }), "  Bday  ");
    await userEvent.click(create);

    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledWith("new"));
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/albums");
    expect(JSON.parse(String(init?.body))).toEqual({ title: "Bday" });
  });

  it("shows the API error", async () => {
    fetchMock.mockResolvedValueOnce(json(503, { detail: "photo storage is not configured" }));
    renderBrowser();
    expect(await screen.findByRole("alert")).toHaveTextContent("photo storage is not configured");
  });
});
