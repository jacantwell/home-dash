import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Page from "./page";
import { POSTS, roomLetter } from "./posts";

describe("Blog page", () => {
  it("renders the heading and a room list", () => {
    render(<Page />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Blog");
    expect(screen.getByRole("navigation", { name: "Chat rooms" })).toBeInTheDocument();
    expect(screen.getByText(/wiped after seven days/i)).toBeInTheDocument();
  });

  it.each(POSTS)("lists $title as chat room $slug", (post) => {
    render(<Page />);
    const rooms = screen.getByRole("navigation", { name: "Chat rooms" });
    const link = within(rooms).getByRole("link", { name: new RegExp(post.title) });
    expect(link).toHaveAttribute("href", `/blog/${post.slug}`);
    expect(link).toHaveTextContent(`Chat Room ${roomLetter(post)}`);
    expect(link).toHaveTextContent(post.date);
  });

  it("orders rooms newest first", () => {
    render(<Page />);
    const rooms = screen.getByRole("navigation", { name: "Chat rooms" });
    const dates = within(rooms)
      .getAllByRole("link")
      .map((a) => a.querySelector("time")?.getAttribute("dateTime"));
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
