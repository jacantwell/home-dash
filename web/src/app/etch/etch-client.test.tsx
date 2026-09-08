import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EtchState } from "@/lib/api";

import { EtchClient } from "./etch-client";

// 8x4 board with (3,1) and (4,1) lit: stream bits 11,12 -> bytes [0,24,0,0].
const state: EtchState = {
  w: 8,
  h: 4,
  x: 3,
  y: 1,
  lit: 2,
  pixels_b64: "ABgAAA==",
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  // jsdom has no canvas 2d context; the component guards a null context.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("EtchClient", () => {
  it("loads the sketch without any auth and shows the cursor", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, state));
    render(<EtchClient />);

    await screen.findAllByText("x 003 · y 001");
    expect(screen.getByText("2 lit pixels")).toBeInTheDocument();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/etch");
    expect(init?.headers).not.toHaveProperty("Authorization");
  });

  it("turning the left knob with the wheel draws horizontally", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, state))
      .mockResolvedValue(jsonResponse(200, { x: 4, y: 1 }));
    render(<EtchClient />);
    await screen.findAllByText("x 003 · y 001");

    const knob = screen.getByTitle("left knob — drag up or down with the mouse");
    fireEvent.wheel(knob, { deltaY: -100 });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/etch/move",
        expect.objectContaining({ method: "POST", body: '{"dx":1,"dy":0}' }),
      );
    });
    await screen.findAllByText("x 004 · y 001");
  });

  it("turning the right knob up draws up", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, state))
      .mockResolvedValue(jsonResponse(200, { x: 3, y: 0 }));
    render(<EtchClient />);
    await screen.findAllByText("x 003 · y 001");

    const knob = screen.getByTitle("right knob — drag up or down with the mouse");
    fireEvent.wheel(knob, { deltaY: -100 });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/etch/move",
        expect.objectContaining({ method: "POST", body: '{"dx":0,"dy":-1}' }),
      );
    });
    await screen.findAllByText("x 003 · y 000");
  });

  it("dragging a knob draws through the pointer travel", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, state))
      .mockResolvedValue(jsonResponse(200, { x: 5, y: 1 }));
    render(<EtchClient />);
    await screen.findAllByText("x 003 · y 001");

    const knob = screen.getByTitle("left knob — drag up or down with the mouse");
    fireEvent.pointerDown(knob, { clientY: 100 });
    fireEvent.pointerMove(knob, { clientY: 70 });
    fireEvent.pointerUp(knob);

    await waitFor(() => {
      const moves = fetchMock.mock.calls.filter(([url]) => url === "/api/etch/move");
      expect(moves.length).toBeGreaterThan(0);
    });
  });

  it("the shake button clears the screen", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, state))
      .mockResolvedValueOnce(jsonResponse(200, { cleared: true, x: 3, y: 1 }))
      .mockResolvedValue(jsonResponse(200, { ...state, lit: 1 }));
    render(<EtchClient />);
    await screen.findAllByText("x 003 · y 001");

    await user.click(screen.getByRole("button", { name: "Shake" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/etch/clear",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await screen.findByText("shaken clean");
  });

  it("shows the board error when loading fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { detail: "etch app is not enabled" }));
    render(<EtchClient />);

    await screen.findByText("etch app is not enabled");
  });

  it("shows a dialog when a move fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, state))
      .mockResolvedValueOnce(jsonResponse(502, { detail: "ledboard unreachable" }));
    render(<EtchClient />);
    await screen.findAllByText("x 003 · y 001");

    const knob = screen.getByTitle("left knob — drag up or down with the mouse");
    fireEvent.wheel(knob, { deltaY: -100 });

    await screen.findByRole("alert");
    expect(screen.getByText("ledboard unreachable")).toBeInTheDocument();
  });
});
