"use client";

import { useAuth } from "@clerk/nextjs";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { PixelIcon } from "@/components/pixel-icon";
import { Button, Dialog, Progress, StatusBar, ToolButton, ToolSeparator } from "@/components/xp";
import {
  ApiError,
  type CalendarEvent,
  createEvent,
  listEvents,
  MAX_EVENT_LOCATION_LENGTH,
  MAX_EVENT_TITLE_LENGTH,
} from "@/lib/api";
import { formatEventWhen, londonToday } from "@/lib/time";

const UPCOMING_LIMIT = 20;
const DEFAULT_START = "19:00";
const DEFAULT_END = "21:00";

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Something went wrong. Try again.";
}

function byStart(a: CalendarEvent, b: CalendarEvent): number {
  return new Date(a.start).getTime() - new Date(b.start).getTime();
}

export function CalendarClient() {
  const { getToken } = useAuth();
  return <HouseCalendar getToken={getToken} />;
}

interface HouseCalendarProps {
  getToken: () => Promise<string | null>;
}

export function HouseCalendar({ getToken }: HouseCalendarProps) {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState(() => londonToday());
  const [start, setStart] = useState(DEFAULT_START);
  const [end, setEnd] = useState(DEFAULT_END);
  const [allDay, setAllDay] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const requireToken = useCallback(async () => {
    const token = await getToken();
    if (!token) throw new ApiError(401, "Your session expired. Sign in again.");
    return token;
  }, [getToken]);

  const load = useCallback(() => {
    let cancelled = false;
    requireToken()
      .then((token) => listEvents(token, UPCOMING_LIMIT))
      .then((list) => {
        if (!cancelled) setEvents(list);
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

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || !date || saving) return;
    setSaving(true);
    setSubmitError(null);
    try {
      const token = await requireToken();
      const created = await createEvent(token, {
        title: trimmed,
        date,
        start_time: allDay ? null : start || null,
        end_time: allDay || !start ? null : end || null,
        location: location.trim() || null,
      });
      setEvents((prev) => [...(prev ?? []), created].sort(byStart));
      setTitle("");
      setLocation("");
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const canSave = Boolean(title.trim()) && Boolean(date) && !saving;
  const count = events?.length ?? 0;

  return (
    <div className="relative">
      <div className="xp-toolbar">
        <ToolButton
          icon="calendar"
          label="Save"
          type="submit"
          form="appointment"
          disabled={!canSave}
        />
        <ToolSeparator />
        <ToolButton icon="refresh" label="Refresh" onClick={refresh} disabled={loading} />
      </div>

      <form id="appointment" onSubmit={onSubmit}>
        <div className="xp-hdr">
          <label className="xp-hdr-label" htmlFor="event-title">
            Subject:
          </label>
          <input
            id="event-title"
            className="xp-field"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_EVENT_TITLE_LENGTH}
            required
            placeholder="pub quiz"
          />
          <label className="xp-hdr-label" htmlFor="event-location">
            Location:
          </label>
          <input
            id="event-location"
            className="xp-field"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={MAX_EVENT_LOCATION_LENGTH}
            placeholder="optional"
          />
          <label className="xp-hdr-label" htmlFor="event-date">
            When:
          </label>
          <span className="flex flex-wrap items-center gap-2">
            <input
              id="event-date"
              type="date"
              className="xp-field w-auto"
              value={date}
              min={londonToday()}
              onChange={(e) => setDate(e.target.value)}
              required
            />
            <input
              type="time"
              aria-label="Start time"
              className="xp-field w-auto"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              disabled={allDay}
            />
            <span aria-hidden>to</span>
            <input
              type="time"
              aria-label="End time"
              className="xp-field w-auto"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              disabled={allDay}
            />
            <label className="xp-check">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
              />
              All day event
            </label>
          </span>
        </div>
      </form>

      <div className="xp-pane-title">
        <PixelIcon name="calendar" size={16} />
        Upcoming
      </div>
      <Upcoming events={events} loading={loading} />

      <StatusBar>
        <span>{loading ? "Checking the calendar..." : `${count} upcoming event(s)`}</span>
        <span>Europe/London</span>
        <span>Online</span>
      </StatusBar>

      {saving && (
        <Dialog title="Saving appointment..." icon="calendar" role="status">
          <div className="flex items-start gap-3">
            <PixelIcon name="calendar" size={32} />
            <div className="flex-1">
              <p className="mb-2">Adding to the house calendar...</p>
              <Progress label="Saving" />
            </div>
          </div>
        </Dialog>
      )}

      {!saving && submitError && (
        <ErrorBox message={submitError} onClose={() => setSubmitError(null)} />
      )}
      {!saving && !submitError && loadError && (
        <ErrorBox message={loadError} onClose={() => setLoadError(null)} />
      )}
    </div>
  );
}

function ErrorBox({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <Dialog
      title="Calendar"
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

function Upcoming({ events, loading }: { events: CalendarEvent[] | null; loading: boolean }) {
  if (!events || events.length === 0) {
    return (
      <div className="flex min-h-20 items-center justify-center bg-white text-[#6d6a5e]">
        {loading && !events ? "Loading..." : "There are no items in this view."}
      </div>
    );
  }

  return (
    <div className="max-h-72 overflow-auto bg-white">
      <table className="xp-list" aria-label="Upcoming events">
        <thead>
          <tr>
            <th className="w-48">When</th>
            <th>Subject</th>
            <th className="hidden sm:table-cell">Location</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>
                <time dateTime={e.start}>{formatEventWhen(e)}</time>
              </td>
              <td>
                {e.link ? (
                  <a href={e.link} target="_blank" rel="noreferrer">
                    {e.title}
                  </a>
                ) : (
                  e.title
                )}
              </td>
              <td className="muted hidden sm:table-cell">{e.location ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
