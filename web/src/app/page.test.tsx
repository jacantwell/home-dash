import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Page from "./page";

describe("Home page", () => {
  it("renders a directory listing with a link to the board", () => {
    render(<Page />);
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Index of /");
    expect(screen.getByRole("link", { name: "board/" })).toHaveAttribute("href", "/board");
    expect(screen.getByText(/send a message to the led board/i)).toBeInTheDocument();
  });
});
