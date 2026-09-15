import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import NotFound from "./not-found";

describe("Not found page", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["heading", () => screen.getByRole("heading", { level: 1 }), "Not Found"],
    ["body", () => screen.getByText(/requested url was not found/i), undefined],
  ] as const)("renders the Apache-style %s", (_label, query, text) => {
    render(<NotFound />);
    const el = query();
    expect(el).toBeInTheDocument();
    if (text) expect(el).toHaveTextContent(text);
  });

  it.each([
    ["set", "1.2.3", "home-dash/1.2.3"],
    ["unset", undefined, "home-dash/dev"],
  ])("shows the server signature when the version is %s", async (_label, version, expected) => {
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", version);
    vi.resetModules();
    const { default: Page } = await import("./not-found");
    render(<Page />);
    expect(screen.getByText(new RegExp(expected))).toBeInTheDocument();
  });

  it("links back to the index", () => {
    render(<NotFound />);
    expect(screen.getByRole("link", { name: /back to index/i })).toHaveAttribute("href", "/");
  });
});
