"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  ApiError,
  type Comment,
  COMMENT_TTL_DAYS,
  listComments,
  MAX_COMMENT_LENGTH,
  MAX_COMMENT_LINES,
  postComment,
} from "@/lib/api";
import { formatAbsolute, formatRelative } from "@/lib/time";

// The DS's sixteen profile colours; the only thing about you this page keeps, and only locally.
export const PEN_COLORS = [
  "#6d7fb3",
  "#a05a2c",
  "#e0281e",
  "#f26f9e",
  "#f78b1f",
  "#f2d21b",
  "#93d21c",
  "#26b827",
  "#1c8a44",
  "#23a889",
  "#20b8c8",
  "#2f6fe0",
  "#3d3fbf",
  "#7a3fc4",
  "#b34fd4",
  "#e03fa0",
] as const;

export const PEN_STORAGE_KEY = "pc-pen";

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Couldn't reach the room. Try again.";
}

// The pen lives in localStorage; useSyncExternalStore reads it without a hydration mismatch.
const penListeners = new Set<() => void>();
let randomPen: string | null = null;

function readPen(): string {
  try {
    const saved = localStorage.getItem(PEN_STORAGE_KEY);
    if (saved && (PEN_COLORS as readonly string[]).includes(saved)) return saved;
  } catch {
    // private mode etc: fall through to a random pen
  }
  randomPen ??= PEN_COLORS[Math.floor(Math.random() * PEN_COLORS.length)];
  return randomPen;
}

function writePen(pen: string) {
  randomPen = pen;
  try {
    localStorage.setItem(PEN_STORAGE_KEY, pen);
  } catch {
    // storage unavailable: the pen still works for this page load
  }
  penListeners.forEach((cb) => cb());
}

function subscribePen(cb: () => void) {
  penListeners.add(cb);
  return () => {
    penListeners.delete(cb);
  };
}

function usePen(): [string, (pen: string) => void] {
  const pen = useSyncExternalStore(subscribePen, readPen, () => PEN_COLORS[0]);
  return [pen, writePen];
}

function capLines(value: string): string {
  return value.split("\n").slice(0, MAX_COMMENT_LINES).join("\n");
}

interface Props {
  slug: string;
  room: string;
}

export function Comments({ slug, room }: Props) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [color, pickPen] = usePen();
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const padRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    let cancelled = false;
    listComments(slug)
      .then((list) => {
        if (!cancelled) setComments(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // newest note sits at the bottom, like a chat
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [comments?.length]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setSubmitError(null);
    try {
      const created = await postComment(slug, { text: trimmed, color });
      setComments((prev) => [...(prev ?? []), created]);
      setText("");
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setPending(false);
      padRef.current?.focus();
    }
  }

  function onPadKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  const count = comments?.length ?? 0;

  return (
    <div className="pc-chat">
      <div className="pc-chat-title">
        <span>Chat Room {room}</span>
        <span className="pc-chat-note">
          everyone is anon &middot; notes fade after {COMMENT_TTL_DAYS} days
        </span>
      </div>

      <ol ref={logRef} className="pc-log" aria-label="Replies" aria-live="polite">
        {comments === null && !loadError && <li className="pc-empty">Entering room...</li>}
        {loadError && (
          <li className="pc-empty" role="alert">
            {loadError}
          </li>
        )}
        {comments?.length === 0 && <li className="pc-empty">Nobody has said anything yet.</li>}
        {comments?.map((c) => (
          <Note key={c.id} comment={c} />
        ))}
      </ol>

      <div className="pc-compose">
        <fieldset className="pc-pens">
          <legend className="sr-only">Pen colour</legend>
          {PEN_COLORS.map((pen) => (
            <label key={pen} className="pc-pen" style={{ background: pen }}>
              <input
                type="radio"
                name="pen"
                value={pen}
                aria-label={`Pen ${pen}`}
                checked={color === pen}
                onChange={() => pickPen(pen)}
              />
            </label>
          ))}
        </fieldset>

        {/* pens sit outside the form so the form is just "write a note, post it" */}
        <form
          className="pc-compose-form"
          aria-label={`Reply in Chat Room ${room}`}
          onSubmit={onSubmit}
        >
          <textarea
            ref={padRef}
            className="pc-pad"
            name="note"
            aria-label="Your note"
            style={{ color, borderColor: color }}
            value={text}
            onChange={(e) => setText(capLines(e.target.value))}
            onKeyDown={onPadKeyDown}
            maxLength={MAX_COMMENT_LENGTH}
            rows={3}
            required
            placeholder="write something..."
          />

          <div className="pc-keys">
            <button type="submit" className="pc-key" disabled={pending}>
              {pending ? "Posting" : "Post note"}
            </button>
            <button
              type="button"
              className="pc-key"
              disabled={!text || pending}
              onClick={() => {
                setText("");
                padRef.current?.focus();
              }}
            >
              Clear
            </button>
          </div>
        </form>
      </div>

      <div className="pc-status">
        <span>{comments === null ? "..." : `${count} note(s)`}</span>
        {submitError && (
          <span role="alert" className="pc-status-error">
            {submitError}
          </span>
        )}
        <span className="ml-auto" aria-live="polite">
          {text.length}/{MAX_COMMENT_LENGTH}
        </span>
      </div>
    </div>
  );
}

function Note({ comment }: { comment: Comment }) {
  return (
    <li className="pc-msg" style={{ "--pen": comment.color } as React.CSSProperties}>
      <span className="pc-tag">anon</span>
      <p className="pc-msg-text">{comment.text}</p>
      <span className="pc-msg-time">
        <time dateTime={comment.created_at} title={formatAbsolute(comment.created_at)}>
          {formatRelative(comment.created_at)}
        </time>
        {" · "}
        <span title={`fades ${formatAbsolute(comment.expires_at)}`}>
          fades {formatRelative(comment.expires_at)}
        </span>
      </span>
    </li>
  );
}
