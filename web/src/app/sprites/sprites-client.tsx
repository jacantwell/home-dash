"use client";

import { SignInButton, useAuth } from "@clerk/nextjs";
import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { PixelIcon } from "@/components/pixel-icon";
import { SpriteImage } from "@/components/sprite-image";
import { Button, Dialog, StatusBar, ToolButton, ToolSeparator } from "@/components/xp";
import {
  ApiError,
  listSprites,
  paletteChar,
  paletteColor,
  saveSprite,
  type Sprite,
  SPRITE_CELLS,
  SPRITE_NAME_MAX,
  SPRITE_NAME_PATTERN,
  SPRITE_PALETTE,
  SPRITE_SIZE,
  SPRITE_TRANSPARENT,
} from "@/lib/api";
import { formatRelative } from "@/lib/time";

type Tool = "pencil" | "eraser" | "fill";

const EMPTY = SPRITE_TRANSPARENT.repeat(SPRITE_CELLS);
const DEFAULT_COLOR_INDEX = 0;

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Something went wrong. Try again.";
}

function setCell(pixels: string, i: number, c: string): string {
  if (pixels[i] === c) return pixels;
  return pixels.slice(0, i) + c + pixels.slice(i + 1);
}

// 4-way flood fill of the contiguous same-colour region around i.
function floodFill(pixels: string, i: number, c: string): string {
  const target = pixels[i];
  if (target === c) return pixels;
  const cells = [...pixels];
  const stack = [i];
  while (stack.length) {
    const n = stack.pop()!;
    if (cells[n] !== target) continue;
    cells[n] = c;
    const x = n % SPRITE_SIZE;
    if (x > 0) stack.push(n - 1);
    if (x < SPRITE_SIZE - 1) stack.push(n + 1);
    if (n >= SPRITE_SIZE) stack.push(n - SPRITE_SIZE);
    if (n < SPRITE_CELLS - SPRITE_SIZE) stack.push(n + SPRITE_SIZE);
  }
  return cells.join("");
}

export function SpritesClient({ signedIn }: { signedIn: boolean }) {
  const { getToken } = useAuth();
  return <SpriteMaker signedIn={signedIn} getToken={getToken} />;
}

interface SpriteMakerProps {
  signedIn: boolean;
  getToken: () => Promise<string | null>;
}

export function SpriteMaker({ signedIn, getToken }: SpriteMakerProps) {
  const [pixels, setPixels] = useState(EMPTY);
  const [tool, setTool] = useState<Tool>("pencil");
  const [colorIndex, setColorIndex] = useState(DEFAULT_COLOR_INDEX);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const [catalog, setCatalog] = useState<Sprite[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const painting = useRef(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = useCallback(() => {
    let cancelled = false;
    listSprites()
      .then((list) => {
        if (!cancelled) setCatalog(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(load, [load]);
  useEffect(() => () => clearTimeout(savedTimer.current), []);

  function refresh() {
    setLoading(true);
    setLoadError(null);
    load();
  }

  const ink = tool === "eraser" ? SPRITE_TRANSPARENT : paletteChar(colorIndex);

  function paint(i: number) {
    setPixels((prev) => (tool === "fill" ? floodFill(prev, i, ink) : setCell(prev, i, ink)));
  }

  function onCellPointerDown(e: ReactPointerEvent<HTMLButtonElement>, i: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    painting.current = tool !== "fill";
    paint(i);
  }

  function onCellPointerEnter(i: number) {
    if (painting.current) paint(i);
  }

  useEffect(() => {
    const stop = () => {
      painting.current = false;
    };
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, []);

  function open(sprite: Sprite) {
    setPixels(sprite.pixels);
    setName("");
  }

  const nameOk = SPRITE_NAME_PATTERN.test(name);
  const drawn = pixels !== EMPTY;
  const canSave = nameOk && drawn && !pending;
  const lit = SPRITE_CELLS - (pixels.match(/\./g)?.length ?? 0);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSave) return;
    if (!signedIn) {
      setNeedLogin(true);
      return;
    }
    setPending(true);
    setSubmitError(null);
    try {
      const token = await getToken();
      if (!token) throw new ApiError(401, "Your session expired. Sign in again.");
      const created = await saveSprite(token, { name, pixels });
      setCatalog((prev) => [created, ...(prev ?? [])]);
      setSaved(created.name);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(null), 2600);
      setName("");
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative">
      <div className="xp-toolbar">
        <ToolButton icon="check" label="Save" type="submit" form="sprite" disabled={!canSave} />
        <ToolSeparator />
        <ToolButton
          icon="pencil"
          label="Pencil"
          aria-pressed={tool === "pencil"}
          onClick={() => setTool("pencil")}
        />
        <ToolButton
          icon="document"
          label="Eraser"
          aria-pressed={tool === "eraser"}
          onClick={() => setTool("eraser")}
        />
        <ToolButton
          icon="board"
          label="Fill"
          aria-pressed={tool === "fill"}
          onClick={() => setTool("fill")}
        />
        <ToolSeparator />
        <ToolButton icon="error" label="Clear" onClick={() => setPixels(EMPTY)} disabled={!drawn} />
        <ToolButton icon="refresh" label="Refresh" onClick={refresh} disabled={loading} />
      </div>

      <form id="sprite" onSubmit={onSubmit} className="sprite-editor">
        <div className="sprite-canvas">
          <div
            className="sprite-grid"
            role="grid"
            aria-label="Canvas"
            style={{ gridTemplateColumns: `repeat(${SPRITE_SIZE}, 1fr)` }}
          >
            {[...pixels].map((c, i) => {
              const fill = paletteColor(c);
              return (
                <button
                  key={i}
                  type="button"
                  role="gridcell"
                  aria-label={`cell ${i % SPRITE_SIZE},${Math.floor(i / SPRITE_SIZE)}`}
                  data-cell={c}
                  className={fill ? "sprite-cell" : "sprite-cell empty"}
                  style={fill ? { background: fill } : undefined}
                  onPointerDown={(e) => onCellPointerDown(e, i)}
                  onPointerEnter={() => onCellPointerEnter(i)}
                />
              );
            })}
          </div>
        </div>

        <div className="sprite-side">
          <div className="sprite-palette" role="radiogroup" aria-label="Colour">
            {SPRITE_PALETTE.map((hex, i) => (
              <button
                key={hex}
                type="button"
                role="radio"
                aria-label={hex}
                aria-checked={i === colorIndex && tool !== "eraser"}
                className="sprite-swatch"
                style={{ background: hex }}
                onClick={() => {
                  setColorIndex(i);
                  if (tool === "eraser") setTool("pencil");
                }}
              />
            ))}
          </div>

          <div className="sprite-preview" aria-label="Preview">
            <SpriteImage sprite={{ w: SPRITE_SIZE, h: SPRITE_SIZE, pixels }} size={32} />
            <SpriteImage sprite={{ w: SPRITE_SIZE, h: SPRITE_SIZE, pixels }} size={64} />
          </div>

          <label className="flex flex-col gap-1">
            <span>Name</span>
            <input
              className="xp-field"
              aria-label="Name"
              value={name}
              onChange={(e) =>
                setName(
                  e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9_]/g, "_")
                    .slice(0, SPRITE_NAME_MAX),
                )
              }
              placeholder="smiley"
              maxLength={SPRITE_NAME_MAX}
              autoComplete="off"
              spellCheck={false}
            />
            <span className="text-[#6d6a5e]">
              a-z, 0-9 and _ only. Shows up in messages as :{name || "name"}:
            </span>
          </label>
        </div>
      </form>

      <div className="xp-pane-title">
        <PixelIcon name="folder" size={16} />
        Catalog
      </div>
      <Catalog sprites={catalog} loading={loading} onOpen={open} />

      <StatusBar>
        <span>
          {loading
            ? "Loading catalog..."
            : saved
              ? `Saved :${saved}:`
              : `${catalog?.length ?? 0} sprite(s)`}
        </span>
        <span aria-live="polite">
          {lit}/{SPRITE_CELLS} px
        </span>
        <span>{tool}</span>
      </StatusBar>

      {needLogin && (
        <Dialog
          title="Log On to Sprite Maker"
          icon="user"
          role="dialog"
          actions={
            <>
              <SignInButton mode="redirect">
                <Button className="default">Sign in...</Button>
              </SignInButton>
              <Button onClick={() => setNeedLogin(false)}>Cancel</Button>
            </>
          }
        >
          <div className="flex items-start gap-3">
            <PixelIcon name="user" size={32} />
            <p className="pt-1">You need to sign in before you can save a sprite.</p>
          </div>
        </Dialog>
      )}

      {submitError && <ErrorBox message={submitError} onClose={() => setSubmitError(null)} />}
      {!submitError && loadError && (
        <ErrorBox message={loadError} onClose={() => setLoadError(null)} />
      )}
    </div>
  );
}

function ErrorBox({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <Dialog
      title="Sprite Maker"
      role="alert"
      actions={
        <Button className="default" onClick={onClose} autoFocus>
          OK
        </Button>
      }
    >
      <div className="flex items-start gap-3">
        <PixelIcon name="error" size={28} />
        <p className="pt-1">{message}</p>
      </div>
    </Dialog>
  );
}

interface CatalogProps {
  sprites: Sprite[] | null;
  loading: boolean;
  onOpen: (sprite: Sprite) => void;
}

function Catalog({ sprites, loading, onOpen }: CatalogProps) {
  if (!sprites || sprites.length === 0) {
    return (
      <div className="flex min-h-20 items-center justify-center bg-white text-[#6d6a5e]">
        {loading && !sprites ? "Loading..." : "No sprites yet. Draw the first one."}
      </div>
    );
  }
  return (
    <ul className="sprite-catalog" aria-label="Catalog">
      {sprites.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            className="sprite-card"
            title={`by ${s.author_name || "someone"}, ${formatRelative(s.created_at)}. Click to open.`}
            onClick={() => onOpen(s)}
          >
            <SpriteImage sprite={s} size={48} label={s.name} />
            <span className="sprite-card-name">:{s.name}:</span>
            <span className="sprite-card-by">{s.author_name || "someone"}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
