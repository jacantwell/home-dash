import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POSTS } from "../posts";
import Page, { generateMetadata, generateStaticParams } from "./page";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const params = (slug: string) => ({
  params: Promise.resolve({ slug }),
  searchParams: Promise.resolve({}),
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ comments: [] }))),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("Post page", () => {
  it.each(POSTS)("renders $slug with its body and a comment box", async ({ slug, title, body }) => {
    render(await Page(params(slug)));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(title);
    for (const para of body) expect(screen.getByText(para)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Your note" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /all rooms/ })).toHaveAttribute("href", "/blog");
  });

  it("404s for an unknown slug", async () => {
    await expect(Page(params("not-a-post"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("prerenders every post", () => {
    expect(generateStaticParams()).toEqual(POSTS.map((p) => ({ slug: p.slug })));
  });

  it.each([
    [POSTS[0].slug, `${POSTS[0].title} · home-dash`],
    ["nope", "Not found · home-dash"],
  ])("titles %s as %s", async (slug, title) => {
    expect(await generateMetadata(params(slug))).toEqual({ title });
  });
});
