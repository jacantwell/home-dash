"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { PixelIcon } from "@/components/pixel-icon";
import { Button, Dialog, StatusBar, ToolButton, ToolSeparator } from "@/components/xp";
import { ApiError, etchClear, etchMove, type EtchState, getEtchState } from "@/lib/api";

// Mouse travel per LED pixel when dragging a knob, and the biggest chunk sent
// in one POST (the Pi clamps each axis to ±32 anyway).
const PX_PER_STEP = 10;
const CHUNK = 5;
const POLL_MS = 5000;
const DOT = 8;

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Something went wrong. Try again.";
}

function decodeBits(st: EtchState): Uint8Array {
  const raw = atob(st.pixels_b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const bits = new Uint8Array(st.w * st.h);
  let n = 0;
  for (let b = 0; b < bytes.length && n < bits.length; b++) {
    for (let k = 7; k >= 0 && n < bits.length; k--) bits[n++] = (bytes[b] >> k) & 1;
  }
  return bits;
}

function inkLine(
  bits: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + (x1 - x0) * (steps ? i / steps : 0));
    const y = Math.round(y0 + (y1 - y0) * (steps ? i / steps : 0));
    if (x >= 0 && x < w && y >= 0 && y < h) bits[y * w + x] = 1;
  }
}

export function EtchClient() {
  return <Etch />;
}

export function Etch() {
  const [etch, setEtch] = useState<EtchState | null>(null);
  const [bits, setBits] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const loaded = useRef(false);

  function say(text: string) {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2600);
  }

  const load = useCallback((quiet: boolean) => {
    let cancelled = false;
    (async () => {
      try {
        const st = await getEtchState();
        if (cancelled) return;
        loaded.current = true;
        setEtch(st);
        setBits(decodeBits(st));
        setLoadError(null);
      } catch (err) {
        if (cancelled) return;
        if (quiet && loaded.current) return; // keep drawing on a blip, the next poll retries
        setLoadError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(false), [load]);
  useEffect(() => {
    const id = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(id);
  }, [load]);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  // Ink the screen: the tabindex-free canvas has no 2d context in tests, so guard it.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bits || !etch) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const r = DOT * 0.36;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, etch.w * DOT, etch.h * DOT);
    for (let y = 0; y < etch.h; y++) {
      for (let x = 0; x < etch.w; x++) {
        ctx.fillStyle = bits[y * etch.w + x] ? "#f2f2f2" : "#141311";
        ctx.beginPath();
        ctx.arc(x * DOT + DOT / 2, y * DOT + DOT / 2, r, 0, 6.2832);
        ctx.fill();
      }
    }
  }, [bits, etch]);

  async function sendMove(dx: number, dy: number) {
    if (!etch || !bits) return;
    const nx = Math.max(0, Math.min(etch.w - 1, etch.x + dx));
    const ny = Math.max(0, Math.min(etch.h - 1, etch.y + dy));
    const next = bits.slice();
    inkLine(next, etch.w, etch.h, etch.x, etch.y, nx, ny);
    setBits(next);
    setEtch({ ...etch, x: nx, y: ny, lit: next.reduce((a, b) => a + b, 0) });
    try {
      const cursor = await etchMove(dx, dy);
      setEtch((prev) => (prev ? { ...prev, x: cursor.x, y: cursor.y } : prev));
    } catch (err) {
      setOpError(errorMessage(err));
      load(true);
    }
  }

  function step(axis: "x" | "y", n: number) {
    // One straight segment per POST; the y knob inverts so dragging up draws up.
    while (n !== 0) {
      const chunk = Math.max(-CHUNK, Math.min(CHUNK, n));
      n -= chunk;
      if (axis === "x") void sendMove(chunk, 0);
      else void sendMove(0, -chunk);
    }
  }

  async function shake(why: string) {
    if (shaking) return;
    setShaking(true);
    try {
      await etchClear();
      say(why);
      load(true);
    } catch (err) {
      setOpError(errorMessage(err));
    } finally {
      setTimeout(() => setShaking(false), 600);
    }
  }

  const cursor = etch
    ? `x ${String(etch.x).padStart(3, "0")} · y ${String(etch.y).padStart(3, "0")}`
    : "…";

  return (
    <div className="relative">
      <div className="xp-toolbar">
        <ToolButton icon="refresh" label="Shake" onClick={() => void shake("shaken clean")} />
        <ToolSeparator />
        <ToolButton icon="pencil" label="Resync" onClick={() => load(false)} disabled={loading} />
      </div>

      <div className="xp-infobar">
        <PixelIcon name="board" size={14} />
        Background layer: messages and bus times draw over the sketch, then it comes back.
      </div>

      {!etch && loading && (
        <div className="flex min-h-40 items-center justify-center bg-white text-[#6d6a5e]">
          Warming up the aluminium powder…
        </div>
      )}
      {!etch && !loading && loadError && (
        <div className="flex min-h-40 items-center justify-center bg-white px-6 text-center text-[#6d6a5e]">
          {loadError}
        </div>
      )}

      {etch && bits && (
        <ShakeFrame shaking={shaking} onShake={() => void shake("shake detected — cleared")}>
          <div className="etch-head">
            <span className="etch-title">ETCH-A-SKETCH</span>
            <span className="etch-sub">knobs only — no keys</span>
          </div>
          <div className="etch-screen">
            <canvas
              ref={canvasRef}
              width={etch.w * DOT}
              height={etch.h * DOT}
              aria-label="Etch-a-sketch screen. Draw by dragging the knobs with the mouse."
            />
          </div>
          <div className="etch-controls">
            <Knob
              label="left"
              sub="◀ ▶"
              hint="drag ↕ to turn"
              ariaLabel="Left knob: horizontal. Drag up or down with the mouse to draw left and right."
              onTurn={(n) => step("x", n)}
            />
            <div className="etch-mid">
              <span className="etch-pos" aria-live="polite">
                {cursor}
              </span>
              <span className="etch-sub">
                {etch.lit} lit pixel{etch.lit === 1 ? "" : "s"}
              </span>
            </div>
            <Knob
              label="right"
              sub="▲ ▼"
              hint="drag ↕ to turn"
              ariaLabel="Right knob: vertical. Drag up or down with the mouse to draw up and down."
              onTurn={(n) => step("y", n)}
            />
          </div>
        </ShakeFrame>
      )}

      <StatusBar>
        <span aria-live="polite">
          {notice ?? "Drag a knob to draw. Grab the frame and waggle it to shake."}
        </span>
        <span>{cursor}</span>
        <span>Online</span>
      </StatusBar>

      {opError && (
        <Dialog
          title="Etch-A-Sketch"
          role="alert"
          actions={
            <Button className="default" onClick={() => setOpError(null)} autoFocus>
              OK
            </Button>
          }
        >
          <div className="flex items-start gap-3">
            <PixelIcon name="error" size={28} />
            <p className="pt-1">{opError}</p>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function ShakeFrame({
  shaking,
  onShake,
  children,
}: {
  shaking: boolean;
  onShake: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const trail = useRef<{ x: number; t: number }[]>([]);
  const down = useRef(false);
  const coolUntil = useRef(0);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest(".etch-knob,button")) return;
    down.current = true;
    trail.current = [{ x: e.clientX, t: performance.now() }];
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!down.current) return;
    if ((e.target as HTMLElement).closest(".etch-knob")) return;
    const now = performance.now();
    const points = [...trail.current, { x: e.clientX, t: now }].filter((p) => now - p.t < 900);
    trail.current = points;
    let reversals = 0;
    for (let i = 2; i < points.length; i++) {
      const d1 = points[i - 1].x - points[i - 2].x;
      const d2 = points[i].x - points[i - 1].x;
      if (Math.abs(d1) > 8 && Math.abs(d2) > 8 && d1 > 0 !== d2 > 0) reversals++;
    }
    const xs = points.map((p) => p.x);
    const span = Math.max(...xs) - Math.min(...xs);
    if (reversals >= 4 && span > 120 && now > coolUntil.current) {
      coolUntil.current = now + 1500;
      down.current = false;
      trail.current = [];
      onShake();
    }
  }

  return (
    <div
      ref={ref}
      className={shaking ? "etch-frame shaking" : "etch-frame"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (down.current = false)}
      onPointerCancel={() => (down.current = false)}
      onPointerLeave={() => (down.current = false)}
    >
      {children}
    </div>
  );
}

function Knob({
  label,
  sub,
  hint,
  ariaLabel,
  onTurn,
}: {
  label: string;
  sub: string;
  hint: string;
  ariaLabel: string;
  onTurn: (n: number) => void;
}) {
  const [angle, setAngle] = useState(0);
  const drag = useRef<{ y: number; acc: number } | null>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const turnRef = useRef(onTurn);
  useEffect(() => {
    turnRef.current = onTurn;
  }, [onTurn]);

  function turn(n: number) {
    if (!n) return;
    setAngle((a) => (a + n * 18) % 360);
    turnRef.current(n);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    drag.current = { y: e.clientY, acc: 0 };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // jsdom and some touch browsers have no pointer capture; dragging still works
    }
    e.preventDefault();
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    d.acc += d.y - e.clientY; // up = clockwise = +
    d.y = e.clientY;
    const n = Math.trunc(d.acc / PX_PER_STEP);
    if (n !== 0) {
      d.acc -= n * PX_PER_STEP;
      turn(n);
    }
  }

  // Native wheel listener: React wheel handlers are passive at the root, and
  // turning the knob must not scroll the page.
  useEffect(() => {
    const el = knobRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      turn(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div className="etch-knob-wrap">
      <div
        ref={knobRef}
        className="etch-knob"
        aria-label={ariaLabel}
        title={`${label} knob — drag up or down with the mouse`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <div className="etch-dial" style={{ transform: `rotate(${angle}deg)` }} />
      </div>
      <span className="etch-knob-label">
        {label} {sub}
      </span>
      <span className="etch-knob-hint">{hint}</span>
    </div>
  );
}
