"use client";

import { useAuth } from "@clerk/nextjs";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  ApiError,
  clampDuration,
  DEFAULT_COLOR,
  DEFAULT_DURATION_S,
  DURATION_PRESETS_S,
  formatDuration,
  listMessages,
  MAX_DURATION_S,
  MAX_MESSAGE_LENGTH,
  MIN_DURATION_S,
  type Message,
  sendMessage,
} from "@/lib/api";
import { formatAbsolute, formatRelative } from "@/lib/time";

const buttonClass =
  "rounded-full bg-zinc-950 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
const chipClass =
  "rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium transition-colors hover:border-zinc-950 aria-pressed:bg-zinc-950 aria-pressed:text-white dark:border-zinc-700 dark:hover:border-zinc-50 dark:aria-pressed:bg-zinc-50 dark:aria-pressed:text-zinc-950";

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Something went wrong. Try again.";
}

export function BoardClient() {
  const { getToken } = useAuth();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [useDefaultColor, setUseDefaultColor] = useState(false);
  // kept as a string so the field can be emptied while typing; clamped on submit
  const [durationInput, setDurationInput] = useState(String(DEFAULT_DURATION_S));
  const duration = clampDuration(Number(durationInput));
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const requireToken = useCallback(async () => {
    const token = await getToken();
    if (!token) throw new ApiError(401, "Your session expired. Sign in again.");
    return token;
  }, [getToken]);

  useEffect(() => {
    let cancelled = false;
    requireToken()
      .then((token) => listMessages(token, 20))
      .then((list) => {
        if (!cancelled) setMessages(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [requireToken]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setSubmitError(null);
    try {
      const token = await requireToken();
      const created = await sendMessage(token, {
        text: trimmed,
        color: useDefaultColor ? null : color,
        duration_s: duration,
      });
      setMessages((prev) => [created, ...(prev ?? [])]);
      setText("");
      setDurationInput(String(duration));
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="board-text" className="text-sm font-medium">
            Message
          </label>
          <input
            id="board-text"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_MESSAGE_LENGTH}
            required
            placeholder="dinner's ready"
            className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 outline-none focus:border-zinc-950 dark:border-zinc-700 dark:focus:border-zinc-50"
          />
          <span className="self-end text-xs text-zinc-500" aria-live="polite">
            {text.length}/{MAX_MESSAGE_LENGTH}
          </span>
        </div>

        <fieldset className="flex flex-wrap items-center gap-4">
          <legend className="sr-only">Colour</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="color"
              aria-label="Text colour"
              value={color}
              onChange={(e) => setColor(e.target.value.toUpperCase())}
              disabled={useDefaultColor}
              className="h-8 w-10 cursor-pointer rounded border border-zinc-300 bg-transparent disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700"
            />
            <span className="font-mono text-xs">{useDefaultColor ? "default" : color}</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={useDefaultColor}
              onChange={(e) => setUseDefaultColor(e.target.checked)}
            />
            Use board default
          </label>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Show for</legend>
          <div className="flex flex-wrap items-center gap-2">
            {DURATION_PRESETS_S.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={duration === preset}
                onClick={() => setDurationInput(String(preset))}
                className={chipClass}
              >
                {formatDuration(preset)}
              </button>
            ))}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="number"
                aria-label="Seconds to show"
                inputMode="numeric"
                min={MIN_DURATION_S}
                max={MAX_DURATION_S}
                step={1}
                value={durationInput}
                onChange={(e) => setDurationInput(e.target.value)}
                onBlur={() => setDurationInput(String(duration))}
                className="w-20 rounded-lg border border-zinc-300 bg-transparent px-3 py-1 text-sm outline-none focus:border-zinc-950 dark:border-zinc-700 dark:focus:border-zinc-50"
              />
              <span className="text-xs text-zinc-500">seconds, max {MAX_DURATION_S}</span>
            </label>
          </div>
        </fieldset>

        <div className="flex items-center gap-4">
          <button type="submit" disabled={pending || !text.trim()} className={buttonClass}>
            {pending ? "Sending…" : "Send to board"}
          </button>
          {submitError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {submitError}
            </p>
          )}
        </div>
      </form>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Recent</h2>
        {loadError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {loadError}
          </p>
        )}
        {messages === null && !loadError && <p className="text-sm text-zinc-500">Loading…</p>}
        {messages?.length === 0 && (
          <p className="text-sm text-zinc-500">Nothing yet. Be the first.</p>
        )}
        {messages && messages.length > 0 && (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {messages.map((m) => (
              <MessageRow key={m.id} message={m} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MessageRow({ message }: { message: Message }) {
  const failed = message.status === "failed";
  return (
    <li className="flex items-start gap-3 py-3">
      <span
        aria-label={message.color ? `colour ${message.color}` : "board default colour"}
        title={message.color ?? "board default"}
        className="mt-1 size-4 shrink-0 rounded-full border border-zinc-300 dark:border-zinc-700"
        style={{ background: message.color ?? "transparent" }}
      />
      <div className="min-w-0 flex-1">
        <p className="break-words">{message.text}</p>
        <p className="text-xs text-zinc-500">
          {message.sender_name || "someone"} ·{" "}
          <time dateTime={message.created_at} title={formatAbsolute(message.created_at)}>
            {formatRelative(message.created_at)}
          </time>
          {message.duration_s !== null && (
            <>
              {" "}
              ·{" "}
              <span title={`shown for ${message.duration_s}s`}>
                {formatDuration(message.duration_s)}
              </span>
            </>
          )}
        </p>
      </div>
      <span
        title={failed ? (message.error ?? "failed") : "delivered to the board"}
        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
          failed
            ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
            : "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
        }`}
      >
        {message.status}
      </span>
    </li>
  );
}
