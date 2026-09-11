"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { PixelIcon } from "@/components/pixel-icon";
import { Button, Dialog, StatusBar, ToolButton, ToolSeparator } from "@/components/xp";
import { ApiError, etchClear, etchMove, type EtchState, getEtchState } from "@/lib/api";

// Knob detent in degrees of spin per LED pixel; wheel travel in px per pixel.
const DEG_PER_STEP = 10;
const WHEEL_PX_PER_STEP = 100;
// Pointer this close to the knob centre has no meaningful angle.
const KNOB_DEAD_ZONE = 6;
// Biggest move in one POST (the backend rejects anything past ±32 per axis).
const MAX_STEP = 32;
const POLL_MS = 5000;
const DOT = 8;

type Segment = { dx: number; dy: number };

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Something went wrong. Try again.";
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
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

// Lights the line and returns how many pixels were newly lit.
function inkLine(
  bits: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  let lit = 0;
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + (x1 - x0) * (steps ? i / steps : 0));
    const y = Math.round(y0 + (y1 - y0) * (steps ? i / steps : 0));
    if (x < 0 || x >= w || y < 0 || y >= h) continue;
    if (!bits[y * w + x]) lit++;
    bits[y * w + x] = 1;
  }
  return lit;
}

// Same axis, same direction: the Pi draws the same line whether it gets one
// POST or two, so these can be merged.
function sameWay(a: Segment, b: Segment) {
  return Math.sign(a.dx) === Math.sign(b.dx) && Math.sign(a.dy) === Math.sign(b.dy);
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

  // Local truth while turns are queued: where the cursor will be once every
  // queued segment lands. One POST in flight at a time keeps the Pi in order.
  const pos = useRef<{ x: number; y: number } | null>(null);
  const bitsRef = useRef<Uint8Array | null>(null);
  const queue = useRef<Segment[]>([]);
  const inflight = useRef(false);

  function busy() {
    return inflight.current || queue.current.length > 0;
  }

  function say(text: string) {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2600);
  }

  const load = useCallback((quiet: boolean) => {
    // Don't rewind the screen under someone's finger; the next poll catches up.
    if (quiet && busy()) return () => {};
    let cancelled = false;
    (async () => {
      try {
        const st = await getEtchState();
        if (cancelled || (quiet && busy())) return;
        loaded.current = true;
        const decoded = decodeBits(st);
        pos.current = { x: st.x, y: st.y };
        bitsRef.current = decoded;
        setEtch(st);
        setBits(decoded);
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

  async function pump() {
    if (inflight.current) return;
    const seg = queue.current.shift();
    if (!seg) return;
    inflight.current = true;
    try {
      const cursor = await etchMove(seg.dx, seg.dy);
      inflight.current = false;
      if (!queue.current.length) {
        // Idle: the Pi's cursor wins (someone else may be turning too).
        pos.current = { x: cursor.x, y: cursor.y };
        setEtch((prev) => (prev ? { ...prev, x: cursor.x, y: cursor.y } : prev));
      }
    } catch (err) {
      inflight.current = false;
      queue.current = [];
      setOpError(errorMessage(err));
      load(true);
      return;
    }
    void pump();
  }

  function enqueue(seg: Segment) {
    const tail = queue.current.at(-1);
    if (
      tail &&
      sameWay(tail, seg) &&
      Math.abs(tail.dx + seg.dx) <= MAX_STEP &&
      Math.abs(tail.dy + seg.dy) <= MAX_STEP
    ) {
      tail.dx += seg.dx;
      tail.dy += seg.dy;
    } else {
      queue.current.push(seg);
    }
  }

  function move(dx: number, dy: number) {
    if (!etch || !pos.current || !bitsRef.current) return;
    const from = pos.current;
    const to = {
      x: clamp(from.x + dx, 0, etch.w - 1),
      y: clamp(from.y + dy, 0, etch.h - 1),
    };
    let ddx = to.x - from.x;
    let ddy = to.y - from.y;
    if (!ddx && !ddy) return; // pinned against the edge

    pos.current = to;
    const next = bitsRef.current.slice();
    const lit = inkLine(next, etch.w, etch.h, from.x, from.y, to.x, to.y);
    bitsRef.current = next;
    setBits(next);
    setEtch((prev) => (prev ? { ...prev, x: to.x, y: to.y, lit: prev.lit + lit } : prev));

    while (ddx || ddy) {
      const sx = clamp(ddx, -MAX_STEP, MAX_STEP);
      const sy = clamp(ddy, -MAX_STEP, MAX_STEP);
      ddx -= sx;
      ddy -= sy;
      enqueue({ dx: sx, dy: sy });
    }
    void pump();
  }

  async function shake(why: string) {
    if (shaking || !etch) return;
    setShaking(true);
    queue.current = [];
    const blank = new Uint8Array(etch.w * etch.h);
    bitsRef.current = blank;
    setBits(blank);
    setEtch((prev) => (prev ? { ...prev, lit: 0 } : prev));
    try {
      await etchClear();
      say(why);
      load(true);
    } catch (err) {
      setOpError(errorMessage(err));
      load(true);
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
            <span className="etch-sub">two knobs · no undo</span>
          </div>
          <div className="etch-screen">
            <canvas
              ref={canvasRef}
              width={etch.w * DOT}
              height={etch.h * DOT}
              aria-label="Etch-a-sketch screen. Draw by spinning the knobs."
            />
          </div>
          <div className="etch-controls">
            <Knob
              label="left"
              sub="◀ ▶"
              hint="spin · scroll · ← →"
              ariaLabel="Left knob: horizontal. Spin clockwise to draw right."
              value={etch.x}
              max={etch.w - 1}
              valueText={`column ${etch.x} of ${etch.w - 1}`}
              orientation="horizontal"
              onTurn={(n) => move(n, 0)}
            />
            <div className="etch-mid">
              <span className="etch-pos">{cursor}</span>
              <span className="etch-sub">
                {etch.lit} lit pixel{etch.lit === 1 ? "" : "s"}
              </span>
            </div>
            <Knob
              label="right"
              sub="▲ ▼"
              hint="spin · scroll · ↑ ↓"
              ariaLabel="Right knob: vertical. Spin clockwise to draw up."
              value={etch.y}
              max={etch.h - 1}
              valueText={`row ${etch.y} from the top`}
              orientation="vertical"
              onTurn={(n) => move(0, -n)}
            />
          </div>
        </ShakeFrame>
      )}

      <StatusBar>
        <span aria-live="polite">
          {notice ?? "Spin a knob to draw. Waggle the frame side to side to shake it clean."}
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

type Drag = {
  id: number;
  cx: number;
  cy: number;
  last: number | null; // null while in the dead zone
  acc: number;
  touch: boolean;
};

const KEY_STEPS: Record<string, number> = {
  ArrowUp: 1,
  ArrowRight: 1,
  ArrowDown: -1,
  ArrowLeft: -1,
  PageUp: 10,
  PageDown: -10,
};

function angleAt(cx: number, cy: number, e: { clientX: number; clientY: number }) {
  return (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI;
}

// A real knob: spin it around its centre. Clockwise is positive. The dial
// follows the pointer 1:1, steps fire every DEG_PER_STEP degrees.
function Knob({
  label,
  sub,
  hint,
  ariaLabel,
  value,
  max,
  valueText,
  orientation,
  onTurn,
}: {
  label: string;
  sub: string;
  hint: string;
  ariaLabel: string;
  value: number;
  max: number;
  valueText: string;
  orientation: "horizontal" | "vertical";
  onTurn: (n: number) => void;
}) {
  const knobRef = useRef<HTMLDivElement>(null);
  const dialRef = useRef<HTMLDivElement>(null);
  const angle = useRef(0);
  const drag = useRef<Drag | null>(null);
  const wheelAcc = useRef(0);
  const turnRef = useRef(onTurn);
  useEffect(() => {
    turnRef.current = onTurn;
  }, [onTurn]);

  function spin(deg: number) {
    angle.current += deg;
    if (dialRef.current) dialRef.current.style.transform = `rotate(${angle.current}deg)`;
  }

  function turn(n: number, haptic = false) {
    if (!n) return;
    turnRef.current(n);
    if (haptic) navigator.vibrate?.(3);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    const r = e.currentTarget.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dead = Math.hypot(e.clientX - cx, e.clientY - cy) < KNOB_DEAD_ZONE;
    drag.current = {
      id: e.pointerId,
      cx,
      cy,
      last: dead ? null : angleAt(cx, cy, e),
      acc: 0,
      touch: e.pointerType === "touch",
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // jsdom has no pointer capture; dragging inside the knob still works
    }
    e.currentTarget.focus({ preventScroll: true });
    e.preventDefault();
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < KNOB_DEAD_ZONE) {
      d.last = null;
      return;
    }
    const a = angleAt(d.cx, d.cy, e);
    if (d.last === null) {
      d.last = a;
      return;
    }
    let delta = a - d.last;
    if (delta > 180) delta -= 360;
    else if (delta < -180) delta += 360;
    d.last = a;
    d.acc += delta;
    spin(delta);
    const n = Math.trunc(d.acc / DEG_PER_STEP);
    if (n) {
      d.acc -= n * DEG_PER_STEP;
      turn(n, d.touch);
    }
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.id === e.pointerId) drag.current = null;
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const n = KEY_STEPS[e.key];
    if (!n) return;
    e.preventDefault();
    const steps = e.shiftKey && Math.abs(n) === 1 ? n * 5 : n;
    spin(steps * DEG_PER_STEP);
    turn(steps);
  }

  // Native wheel listener: React wheel handlers are passive at the root, and
  // turning the knob must not scroll the page. Trackpads fire many tiny deltas,
  // so accumulate instead of stepping per event. Up or right = clockwise.
  // Layout effect so the listener exists the moment the knob is in the DOM.
  useLayoutEffect(() => {
    const el = knobRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : -e.deltaY;
      wheelAcc.current += e.deltaMode === 0 ? raw : raw * 33;
      const n = Math.trunc(wheelAcc.current / WHEEL_PX_PER_STEP);
      if (n) {
        wheelAcc.current -= n * WHEEL_PX_PER_STEP;
        spin(n * DEG_PER_STEP);
        turn(n);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div className="etch-knob-wrap">
      <div
        ref={knobRef}
        className="etch-knob"
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-orientation={orientation}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText}
        title={`${label} knob — spin it, scroll on it, or use the arrow keys`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        <div ref={dialRef} className="etch-dial" />
      </div>
      <span className="etch-knob-label">
        {label} {sub}
      </span>
      <span className="etch-knob-hint">{hint}</span>
    </div>
  );
}
