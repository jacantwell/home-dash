import { useAuth } from "@clerk/nextjs";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CalendarEvent } from "@/lib/api";

import { CalendarClient } from "./calendar-client";

const quiz: CalendarEvent = {
  id: "ev1",
  title: "Pub quiz",
  start: "2030-10-02T19:30:00+01:00",
  end: "2030-10-02T21:00:00+01:00",
  all_day: false,
  location: "The Crown",
  link: "https://calendar.google.com/event?eid=ev1",
};

const bins: CalendarEvent = {
  id: "ev2",
  title: "Bin day",
  start: "2030-10-09",
  end: "2030-10-10",
  all_day: true,
  location: null,
  link: null,
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

function eventRows() {
  return screen.queryAllByRole("row").filter((row) => row.closest("tbody"));
}

function postedBody(): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[1];
  return JSON.parse(String(init?.body));
}

const fetchMock = vi.fn<typeof fetch>();
const getToken = vi.fn(async (): Promise<string | null> => "test-token");

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(useAuth).mockReturnValue({
    isLoaded: true,
    isSignedIn: true,
    userId: "user_test",
    getToken,
  } as unknown as ReturnType<typeof useAuth>);
  fetchMock.mockReset();
  getToken.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderLoaded(events: CalendarEvent[] = [quiz, bins]) {
  fetchMock.mockResolvedValueOnce(jsonResponse(200, { events }));
  render(<CalendarClient />);
  await waitFor(() => expect(screen.queryByText("Loading...")).not.toBeInTheDocument());
}

describe("CalendarClient", () => {
  it("loads upcoming events with the bearer token", async () => {
    await renderLoaded();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/events?limit=20");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer test-token" });
    expect(eventRows()).toHaveLength(2);
    expect(screen.getByText("2 upcoming event(s)")).toBeInTheDocument();
  });

  it.each([
    ["timed", 0, "Wed 2 Oct, 19:30–21:00", "Pub quiz", "The Crown"],
    ["all day", 1, "Wed 9 Oct (all day)", "Bin day", ""],
  ])("renders a %s row", async (_kind, index, when, title, where) => {
    await renderLoaded();
    const cells = within(eventRows()[index]).getAllByRole("cell");
    expect(cells.map((c) => c.textContent)).toEqual([when, title, where]);
  });

  it.each([
    ["links to Google when there's a link", quiz, true],
    ["plain text when there isn't", bins, false],
  ])("title is %s", async (_name, event, linked) => {
    await renderLoaded([event]);
    const link = screen.queryByRole("link", { name: event.title });
    if (linked) expect(link).toHaveAttribute("href", event.link);
    else expect(link).not.toBeInTheDocument();
  });

  it("shows the empty state when nothing is coming up", async () => {
    await renderLoaded([]);
    expect(screen.getByText("There are no items in this view.")).toBeInTheDocument();
  });

  it("can't save without a subject", async () => {
    await renderLoaded();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it.each([
    [
      "timed with location",
      { location: "The Crown", allDay: false },
      { start_time: "19:00", end_time: "21:00", location: "The Crown" },
    ],
    [
      "all day drops the times",
      { location: "", allDay: true },
      { start_time: null, end_time: null, location: null },
    ],
  ])("posts a %s event", async (_name, input, expected) => {
    const user = userEvent.setup();
    const created: CalendarEvent = { ...quiz, id: "ev3", title: "Film night" };
    await renderLoaded([]);
    fetchMock.mockResolvedValueOnce(jsonResponse(201, created));

    await user.type(screen.getByLabelText("Subject:"), "  Film night ");
    if (input.location) await user.type(screen.getByLabelText("Location:"), input.location);
    if (input.allDay) await user.click(screen.getByLabelText("All day event"));
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(eventRows()).toHaveLength(1));
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/events");
    expect(init?.method).toBe("POST");
    expect(postedBody()).toMatchObject({ title: "Film night", ...expected });
    expect(postedBody().date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByLabelText("Subject:")).toHaveValue("");
  });

  it("slots a new event into start order", async () => {
    const user = userEvent.setup();
    const early: CalendarEvent = {
      ...quiz,
      id: "ev0",
      title: "Brunch",
      start: "2030-10-01T10:00:00+01:00",
      end: "2030-10-01T11:00:00+01:00",
    };
    await renderLoaded();
    fetchMock.mockResolvedValueOnce(jsonResponse(201, early));

    await user.type(screen.getByLabelText("Subject:"), "Brunch");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(eventRows()).toHaveLength(3));
    expect(eventRows().map((r) => within(r).getAllByRole("cell")[1].textContent)).toEqual([
      "Brunch",
      "Pub quiz",
      "Bin day",
    ]);
  });

  it.each([
    ["the save fails", 502, { detail: "google returned 403" }, "google returned 403"],
    [
      "validation fails",
      422,
      { detail: [{ msg: "date must not be in the past" }] },
      "date must not be in the past",
    ],
  ])("shows an error box when %s", async (_name, status, body, message) => {
    const user = userEvent.setup();
    await renderLoaded();
    fetchMock.mockResolvedValueOnce(jsonResponse(status, body));

    await user.type(screen.getByLabelText("Subject:"), "Film night");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(screen.getByLabelText("Subject:")).toHaveValue("Film night");
    await user.click(within(alert).getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    [
      "the calendar isn't configured",
      503,
      { detail: "calendar not configured" },
      "calendar not configured",
    ],
    ["google is down", 502, { detail: "google returned 500" }, "google returned 500"],
  ])("shows a load error when %s", async (_name, status, body, message) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(status, body));
    render(<CalendarClient />);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("asks to sign in again when the session has no token", async () => {
    getToken.mockResolvedValueOnce(null);
    render(<CalendarClient />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/session expired/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refresh reloads the list", async () => {
    const user = userEvent.setup();
    await renderLoaded([]);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { events: [quiz] }));

    await user.click(screen.getByRole("button", { name: /^refresh$/i }));
    await waitFor(() => expect(eventRows()).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
