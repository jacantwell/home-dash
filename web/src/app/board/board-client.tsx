"use client";

import { useAuth } from "@clerk/nextjs";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { PixelIcon } from "@/components/pixel-icon";
import { Button, Dialog, Progress, StatusBar, ToolButton, ToolSeparator } from "@/components/xp";
import {
  ApiError,
  DEFAULT_COLOR,
  DEFAULT_DURATION_S,
  DURATION_PRESETS_S,
  formatDuration,
  listMessages,
  MAX_MESSAGE_LENGTH,
  type Message,
  sendMessage,
} from "@/lib/api";
import { formatAbsolute, formatRelative } from "@/lib/time";

const RECIPIENT = "LED Board (hallway)";
// Keep the sending dialog on screen long enough to read; requests usually beat it.
const MIN_SENDING_MS = 600;

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Something went wrong. Try again.";
}

export function BoardClient() {
  const { getToken } = useAuth();
  return <Board getToken={getToken} />;
}

interface BoardProps {
  getToken: () => Promise<string | null>;
}

export function Board({ getToken }: BoardProps) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [text, setText] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [useDefaultColor, setUseDefaultColor] = useState(false);
  const [duration, setDuration] = useState<number | null>(DEFAULT_DURATION_S);
  const [pending, setPending] = useState(false);
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const sendingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const requireToken = useCallback(async () => {
    const token = await getToken();
    if (!token) throw new ApiError(401, "Your session expired. Sign in again.");
    return token;
  }, [getToken]);

  const load = useCallback(() => {
    let cancelled = false;
    requireToken()
      .then((token) => listMessages(token, 20))
      .then((list) => {
        if (!cancelled) setMessages(list);
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
  }, [requireToken]);

  useEffect(load, [load]);

  function refresh() {
    setLoading(true);
    setLoadError(null);
    load();
  }
  useEffect(() => () => clearTimeout(sendingTimer.current), []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setSending(true);
    setSubmitError(null);
    const started = Date.now();
    try {
      const token = await requireToken();
      const created = await sendMessage(token, {
        text: trimmed,
        color: useDefaultColor ? null : color,
        duration_s: duration,
      });
      setMessages((prev) => [created, ...(prev ?? [])]);
      setSelectedId(created.id);
      setText("");
      const remaining = Math.max(0, MIN_SENDING_MS - (Date.now() - started));
      sendingTimer.current = setTimeout(() => setSending(false), remaining);
    } catch (err) {
      setSending(false);
      setSubmitError(errorMessage(err));
    } finally {
      setPending(false);
      bodyRef.current?.focus();
    }
  }

  function onBodyKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  const canSend = Boolean(text.trim()) && !pending;
  const selected = messages?.find((m) => m.id === selectedId) ?? messages?.[0] ?? null;
  const count = messages?.length ?? 0;

  return (
    <div className="relative">
      <div className="xp-toolbar">
        <ToolButton icon="envelope" label="Send" type="submit" form="compose" disabled={!canSend} />
        <ToolSeparator />
        <ToolButton icon="refresh" label="Refresh" onClick={refresh} disabled={loading} />
      </div>

      <form id="compose" onSubmit={onSubmit}>
        <div className="xp-hdr">
          <span className="xp-hdr-label">To:</span>
          <span className="xp-field flex items-center gap-2">
            <PixelIcon name="board" size={16} />
            {RECIPIENT}
          </span>
        </div>

        <div className="xp-fmt">
          <select className="xp-select" aria-label="Font" disabled defaultValue="pixel">
            <option value="pixel">Board 5×7</option>
          </select>
          <select className="xp-select" aria-label="Size" disabled defaultValue="16">
            <option value="16">16</option>
          </select>
          <ToolSeparator />
          <label className="xp-color" title="Text colour">
            <span className="glyph" aria-hidden>
              A
            </span>
            <span
              className="swatch"
              style={{ background: useDefaultColor ? DEFAULT_COLOR : color }}
            />
            <input
              type="color"
              aria-label="Text colour"
              value={color}
              onChange={(e) => setColor(e.target.value.toUpperCase())}
              disabled={useDefaultColor}
            />
          </label>
          <span className="font-mono text-[11px]">{useDefaultColor ? "default" : color}</span>
          <label className="xp-check ml-2">
            <input
              type="checkbox"
              checked={useDefaultColor}
              onChange={(e) => setUseDefaultColor(e.target.checked)}
            />
            Use board default
          </label>
          <ToolSeparator />
          <label className="xp-check">
            Show for
            <select
              className="xp-select"
              aria-label="Duration"
              value={duration ?? ""}
              onChange={(e) => setDuration(e.target.value === "" ? null : Number(e.target.value))}
            >
              {DURATION_PRESETS_S.map((s) => (
                <option key={s} value={s}>
                  {formatDuration(s)}
                </option>
              ))}
              <option value="">board default</option>
            </select>
          </label>
        </div>

        <textarea
          ref={bodyRef}
          id="board-text"
          aria-label="Message"
          className="xp-body"
          value={text}
          onChange={(e) => setText(e.target.value.replace(/[\r\n]+/g, " "))}
          onKeyDown={onBodyKeyDown}
          maxLength={MAX_MESSAGE_LENGTH}
          rows={3}
          required
          placeholder="dinner's ready"
        />
      </form>

      <div className="xp-pane-title">
        <PixelIcon name="folder" size={16} />
        Sent Items
      </div>
      <SentItems
        messages={messages}
        loading={loading}
        selectedId={selected?.id ?? null}
        onSelect={setSelectedId}
      />
      {selected && <Preview message={selected} />}

      <StatusBar>
        <span>{loading ? "Checking for new messages..." : `${count} message(s)`}</span>
        <span aria-live="polite">
          {text.length}/{MAX_MESSAGE_LENGTH}
        </span>
        <span>Online</span>
      </StatusBar>

      {sending && (
        <Dialog title="Sending mail..." icon="envelope" role="status">
          <div className="flex items-start gap-3">
            <PixelIcon name="envelope" size={32} />
            <div className="flex-1">
              <p className="mb-2">Sending message 1 of 1...</p>
              <Progress label="Sending" />
            </div>
          </div>
        </Dialog>
      )}

      {!sending && submitError && (
        <ErrorBox message={submitError} onClose={() => setSubmitError(null)} />
      )}
      {!sending && !submitError && loadError && (
        <ErrorBox message={loadError} onClose={() => setLoadError(null)} />
      )}
    </div>
  );
}

function ErrorBox({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <Dialog
      title="LED Board"
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

interface SentItemsProps {
  messages: Message[] | null;
  loading: boolean;
  selectedId: number | null;
  onSelect: (id: number) => void;
}

function SentItems({ messages, loading, selectedId, onSelect }: SentItemsProps) {
  if (!messages || messages.length === 0) {
    return (
      <div className="flex min-h-20 items-center justify-center bg-white text-[#6d6a5e]">
        {loading && !messages ? "Loading..." : "There are no items in this view."}
      </div>
    );
  }

  function onKeyDown(e: KeyboardEvent<HTMLTableRowElement>, id: number) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(id);
    }
  }

  return (
    <div className="max-h-56 overflow-auto bg-white">
      <table className="xp-list" role="grid" aria-label="Sent Items">
        <thead>
          <tr>
            <th className="w-16">Status</th>
            <th className="w-28">From</th>
            <th>Message</th>
            <th className="hidden w-36 sm:table-cell">Sent</th>
          </tr>
        </thead>
        <tbody>
          {messages.map((m) => {
            const failed = m.status === "failed";
            return (
              <tr
                key={m.id}
                tabIndex={0}
                aria-selected={m.id === selectedId}
                onClick={() => onSelect(m.id)}
                onKeyDown={(e) => onKeyDown(e, m.id)}
              >
                <td>
                  <span
                    className="inline-flex items-center gap-1"
                    title={failed ? (m.error ?? "failed") : "delivered to the board"}
                  >
                    <PixelIcon name={failed ? "error" : "check"} size={11} />
                    {m.status}
                  </span>
                </td>
                <td>{m.sender_name || "someone"}</td>
                <td>{m.text}</td>
                <td className="muted hidden sm:table-cell">
                  <time dateTime={m.created_at} title={formatRelative(m.created_at)}>
                    {formatAbsolute(m.created_at)}
                  </time>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Preview({ message }: { message: Message }) {
  const failed = message.status === "failed";
  return (
    <div className="xp-preview" aria-label="Preview">
      <dl>
        <dt>From:</dt>
        <dd>{message.sender_name || "someone"}</dd>
        <dt>To:</dt>
        <dd>{RECIPIENT}</dd>
        <dt>Sent:</dt>
        <dd>
          <time dateTime={message.created_at}>{formatAbsolute(message.created_at)}</time>{" "}
          <span className="text-[#6d6a5e]">({formatRelative(message.created_at)})</span>
        </dd>
        <dt>Shown for:</dt>
        <dd>
          {message.duration_s === null ? "board default" : formatDuration(message.duration_s)}
        </dd>
      </dl>
      {failed && (
        <div className="xp-infobar">
          <PixelIcon name="error" size={14} />
          Delivery failed: {message.error ?? "unknown error"}
        </div>
      )}
      <div className="led" style={{ color: message.color ?? DEFAULT_COLOR }}>
        {message.text}
      </div>
    </div>
  );
}
