import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import NotFound from "./not-found";

describe("Not found page", () => {
  it.each([
    ["heading", () => screen.getByRole("heading", { level: 1 }), "Not Found"],
    ["body", () => screen.getByText(/requested url was not found/i), undefined],
  ] as const)("renders the Apache-style %s", (_label, query, text) => {
    render(<NotFound />);
    const el = query();
    expect(el).toBeInTheDocument();
    if (text) expect(el).toHaveTextContent(text);
  });

  it("links back to the index", () => {
    render(<NotFound />);
    expect(screen.getByRole("link", { name: /back to index/i })).toHaveAttribute("href", "/");
  });
});
