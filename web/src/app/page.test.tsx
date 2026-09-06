import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Page from "./page";

describe("Home page", () => {
  it("renders the landing with a link to the board", () => {
    render(<Page />);
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("home-dash");
    expect(screen.getByRole("link", { name: /open the board/i })).toHaveAttribute("href", "/board");
  });
});
