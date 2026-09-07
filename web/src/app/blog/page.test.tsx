import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { formatApacheDay } from "@/lib/time";

import Page from "./page";
import { POSTS, roomLetter } from "./posts";

function rooms() {
  return screen.getByRole("table", { name: "Chat rooms" });
}

describe("Blog page", () => {
  it("renders the heading and a room table", () => {
    render(<Page />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Index of /blog");
    expect(rooms()).toBeInTheDocument();
    expect(screen.getByText(/wiped after seven days/i)).toBeInTheDocument();
    expect(screen.getByText(/please select a chat room/i)).toBeInTheDocument();
  });

  it.each(POSTS)("lists $title as chat room $slug", (post) => {
    render(<Page />);
    const row = within(rooms()).getByRole("link", { name: post.slug }).closest("tr")!;
    expect(within(row).getByRole("link", { name: post.slug })).toHaveAttribute(
      "href",
      `/blog/${post.slug}`,
    );
    expect(row).toHaveTextContent(`[${roomLetter(post)}]`);
    expect(row).toHaveTextContent(post.title);
    expect(within(row).getByText(formatApacheDay(post.date))).toHaveAttribute(
      "dateTime",
      post.date,
    );
  });

  it("orders rooms newest first", () => {
    render(<Page />);
    const dates = [...rooms().querySelectorAll("tbody time")].map((t) =>
      t.getAttribute("dateTime"),
    );
    expect(dates).toHaveLength(POSTS.length);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});

describe("roomLetter", () => {
  it("assigns letters by publish order, not display order", () => {
    const chronological = [...POSTS].sort((a, b) => a.date.localeCompare(b.date));
    expect(chronological.map(roomLetter)).toEqual(
      chronological.map((_, i) => String.fromCharCode(65 + i)),
    );
  });
});
