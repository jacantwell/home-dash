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

function moveCalls() {
  return fetchMock.mock.calls
    .filter(([url]) => url === "/api/etch/move")
    .map(([, init]) => JSON.parse(String(init?.body)) as { dx: number; dy: number });
}

async function renderLoaded(...moves: { x: number; y: number }[]) {
  fetchMock.mockResolvedValueOnce(jsonResponse(200, state));
  for (const m of moves) fetchMock.mockResolvedValueOnce(jsonResponse(200, m));
  fetchMock.mockResolvedValue(jsonResponse(200, moves.at(-1) ?? { x: state.x, y: state.y }));
  render(<EtchClient />);
  await screen.findAllByText("x 003 · y 001");
}

function knob(which: "left" | "right") {
  return screen.getByRole("slider", { name: new RegExp(`^${which} knob`, "i") });
}

// Put the knob at a known spot so pointer angles mean something in jsdom.
function placeKnob(el: HTMLElement, cx: number, cy: number, size = 68) {
  el.getBoundingClientRect = () =>
    ({
      left: cx - size / 2,
      top: cy - size / 2,
      width: size,
      height: size,
      right: cx + size / 2,
      bottom: cy + size / 2,
      x: cx - size / 2,
      y: cy - size / 2,
      toJSON: () => ({}),
    }) as DOMRect;
}

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
    await renderLoaded();
    expect(screen.getByText("2 lit pixels")).toBeInTheDocument();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/etch");
    expect(init?.headers).not.toHaveProperty("Authorization");
  });

  it("exposes the knobs as sliders over the board", async () => {
    await renderLoaded();
    expect(knob("left")).toHaveAttribute("aria-valuenow", "3");
    expect(knob("left")).toHaveAttribute("aria-valuemax", "7");
    expect(knob("right")).toHaveAttribute("aria-valuenow", "1");
    expect(knob("right")).toHaveAttribute("aria-orientation", "vertical");
  });

  it.each([
    ["left", { deltaY: -100 }, { dx: 1, dy: 0 }, "x 004 · y 001"],
    ["left", { deltaY: 100 }, { dx: -1, dy: 0 }, "x 002 · y 001"],
    ["left", { deltaX: 100 }, { dx: 1, dy: 0 }, "x 004 · y 001"],
    ["right", { deltaY: -100 }, { dx: 0, dy: -1 }, "x 003 · y 000"],
    ["right", { deltaY: 100 }, { dx: 0, dy: 1 }, "x 003 · y 002"],
  ] as const)("wheel on the %s knob %j moves %j", async (which, wheel, expected, shown) => {
    await renderLoaded({ x: state.x + expected.dx, y: state.y + expected.dy });

    fireEvent.wheel(knob(which), wheel);

    await waitFor(() => expect(moveCalls()).toEqual([expected]));
    await screen.findAllByText(shown);
  });

  it("accumulates small trackpad deltas instead of stepping per event", async () => {
    await renderLoaded({ x: 4, y: 1 });
    const el = knob("left");

    fireEvent.wheel(el, { deltaY: -30 });
    fireEvent.wheel(el, { deltaY: -30 });
    expect(moveCalls()).toEqual([]);
    fireEvent.wheel(el, { deltaY: -50 });

    await waitFor(() => expect(moveCalls()).toEqual([{ dx: 1, dy: 0 }]));
  });

  it.each([
    ["left", "ArrowRight", {}, { dx: 1, dy: 0 }],
    ["left", "ArrowLeft", {}, { dx: -1, dy: 0 }],
    ["left", "ArrowUp", { shiftKey: true }, { dx: 4, dy: 0 }],
    ["left", "PageDown", {}, { dx: -3, dy: 0 }],
    ["right", "ArrowUp", {}, { dx: 0, dy: -1 }],
    ["right", "ArrowDown", {}, { dx: 0, dy: 1 }],
    ["right", "ArrowDown", { shiftKey: true }, { dx: 0, dy: 2 }],
  ] as const)(
    "%s knob + %s %j sends %j, clamped to the board",
    async (which, key, mods, expected) => {
      await renderLoaded({ x: state.x + expected.dx, y: state.y + expected.dy });

      const el = knob(which);
      el.focus();
      fireEvent.keyDown(el, { key, ...mods });

      await waitFor(() => expect(moveCalls()).toEqual([expected]));
    },
  );

  it("spinning a knob clockwise steps once per 10 degrees", async () => {
    await renderLoaded({ x: 7, y: 1 });
    const el = knob("left");
    placeKnob(el, 100, 100);

    // top -> right is a quarter turn clockwise: 9 detents, clamped at the edge (x=7).
    fireEvent.pointerDown(el, { clientX: 100, clientY: 60, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 128, clientY: 72, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 140, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(el, { pointerId: 1 });

    await waitFor(() => expect(moveCalls()).toEqual([{ dx: 4, dy: 0 }]));
    await screen.findAllByText("x 007 · y 001");
  });

  it("ignores pointers that didn't start the drag", async () => {
    await renderLoaded();
    const el = knob("left");
    placeKnob(el, 100, 100);

    fireEvent.pointerDown(el, { clientX: 100, clientY: 60, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 140, clientY: 100, pointerId: 2 });
    fireEvent.pointerUp(el, { pointerId: 2 });
    fireEvent.pointerMove(el, { clientX: 100, clientY: 60, pointerId: 1 });

    await new Promise((r) => setTimeout(r, 20));
    expect(moveCalls()).toEqual([]);
  });

  it("queues turns behind the in-flight POST and merges same-direction ones", async () => {
    let release!: (value: Response) => void;
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, state))
      .mockImplementationOnce(() => new Promise<Response>((r) => (release = r)))
      .mockResolvedValue(jsonResponse(200, { x: 6, y: 1 }));
    render(<EtchClient />);
    await screen.findAllByText("x 003 · y 001");
    const el = knob("left");

    fireEvent.wheel(el, { deltaY: -100 });
    fireEvent.wheel(el, { deltaY: -100 });
    fireEvent.wheel(el, { deltaY: -100 });
    await screen.findAllByText("x 006 · y 001");
    expect(moveCalls()).toEqual([{ dx: 1, dy: 0 }]);

    release(jsonResponse(200, { x: 4, y: 1 }));
    await waitFor(() =>
      expect(moveCalls()).toEqual([
        { dx: 1, dy: 0 },
        { dx: 2, dy: 0 },
      ]),
    );
  });

  it("keeps a direction change as its own segment", async () => {
    let release!: (value: Response) => void;
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, state))
      .mockImplementationOnce(() => new Promise<Response>((r) => (release = r)))
      .mockResolvedValue(jsonResponse(200, { x: 4, y: 0 }));
    render(<EtchClient />);
    await screen.findAllByText("x 003 · y 001");

    fireEvent.wheel(knob("left"), { deltaY: -100 });
    fireEvent.wheel(knob("right"), { deltaY: -100 });
    fireEvent.wheel(knob("left"), { deltaY: 100 });
    release(jsonResponse(200, { x: 4, y: 1 }));

    await waitFor(() =>
      expect(moveCalls()).toEqual([
        { dx: 1, dy: 0 },
        { dx: 0, dy: -1 },
        { dx: -1, dy: 0 },
      ]),
    );
  });

  it("the shake button clears the screen", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, state))
      .mockResolvedValueOnce(jsonResponse(200, { cleared: true, x: 3, y: 1 }))
      .mockResolvedValue(jsonResponse(200, { ...state, lit: 0, pixels_b64: "AAAAAA==" }));
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
    expect(screen.getByText("0 lit pixels")).toBeInTheDocument();
  });

  it("shows the board error when loading fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { detail: "etch app is not enabled" }));
    render(<EtchClient />);

    await screen.findByText("etch app is not enabled");
  });

  it("shows a dialog when a move fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, state))
      .mockResolvedValueOnce(jsonResponse(502, { detail: "ledboard unreachable" }))
      .mockResolvedValue(jsonResponse(200, state));
    render(<EtchClient />);
    await screen.findAllByText("x 003 · y 001");

    fireEvent.wheel(knob("left"), { deltaY: -100 });

    await screen.findByRole("alert");
    expect(screen.getByText("ledboard unreachable")).toBeInTheDocument();
  });
});
