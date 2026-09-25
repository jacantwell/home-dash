const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export function formatRelative(iso: string, now: Date = new Date()): string {
  const diff = new Date(iso).getTime() - now.getTime();
  if (Number.isNaN(diff)) return "";
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return "just now";
}

export function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-GB");
}

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const pad = (n: number) => String(n).padStart(2, "0");

/** Apache's `%d-%b-%Y %H:%M`, for a directory listing's "Last modified". */
export function formatApacheStamp(d: Date): string {
  const date = `${pad(d.getDate())}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The same, for a plain `YYYY-MM-DD`. Split as text so the day can't drift a timezone. */
export function formatApacheDay(iso: string): string {
  const [y, m, d] = iso.split("-");
  const month = MONTHS[Number(m) - 1];
  return month && y && d ? `${d}-${month}-${y}` : iso;
}

// The house is in London whatever the viewer's laptop says.
const LONDON = "Europe/London";
const eventDay = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: LONDON,
});
const eventTime = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: LONDON,
});
// All-day dates are pinned to UTC noon so no timezone can move them a day.
const plainDay = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function formatPlainDay(iso: string, offsetDays = 0): string {
  const [y, m, d] = iso.split("-").map(Number);
  return plainDay.format(new Date(Date.UTC(y, m - 1, d + offsetDays, 12)));
}

/** "Fri 3 Oct, 19:30–21:00", "Sat 4 Oct (all day)", or a range across days. */
export function formatEventWhen(event: { start: string; end: string; all_day: boolean }): string {
  if (event.all_day) {
    const first = formatPlainDay(event.start);
    const last = formatPlainDay(event.end, -1); // Google's end date is exclusive
    return first === last ? `${first} (all day)` : `${first} – ${last}`;
  }
  const start = new Date(event.start);
  const end = new Date(event.end);
  const startDay = eventDay.format(start);
  const endDay = eventDay.format(end);
  const range =
    startDay === endDay
      ? `${eventTime.format(start)}–${eventTime.format(end)}`
      : `${eventTime.format(start)} – ${endDay} ${eventTime.format(end)}`;
  return `${startDay}, ${range}`;
}

/** Today in London as YYYY-MM-DD, for date inputs. */
export function londonToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: LONDON }).format(now);
}
