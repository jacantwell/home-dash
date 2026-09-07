import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { REFERENCES, SECTIONS } from "./content";
import Page from "./page";

describe("Terms page", () => {
  it("renders the heading and a contents box", () => {
    render(<Page />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Terms and Conditions");
    expect(screen.getByRole("navigation", { name: "Contents" })).toBeInTheDocument();
  });

  it.each(SECTIONS)("links the contents entry for $title to its section", ({ id, title }) => {
    render(<Page />);
    const toc = screen.getByRole("navigation", { name: "Contents" });
    const link = within(toc).getByRole("link", { name: new RegExp(`\\d+ ${title}$`) });
    expect(link).toHaveAttribute("href", `#${id}`);
    expect(screen.getByRole("heading", { level: 2, name: new RegExp(title) })).toHaveAttribute(
      "id",
      id,
    );
  });

  it.each(REFERENCES)("cites reference $id at least once", ({ id, text }) => {
    render(<Page />);
    expect(screen.getAllByRole("link", { name: `[${id}]` }).length).toBeGreaterThan(0);
    expect(screen.getByText(text, { exact: false })).toBeInTheDocument();
  });

  it.each(["Worm", "Annelida", "Charles_Darwin", "Wormhole"])(
    "clicks through to wikipedia for %s",
    (slug) => {
      render(<Page />);
      const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
      expect(links).toContain(`https://en.wikipedia.org/wiki/${slug}`);
    },
  );

  it("links back to the board and the index", () => {
    render(<Page />);
    expect(screen.getAllByRole("link", { name: "LED board" })[0]).toHaveAttribute("href", "/board");
    expect(screen.getByRole("link", { name: "Index of /" })).toHaveAttribute("href", "/");
  });
});
