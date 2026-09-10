import { afterEach, describe, expect, it, vi } from "vitest";

import { POSTS } from "./chatroom/posts";
import sitemap, { siteUrl } from "./sitemap";

describe("siteUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    [{ NEXT_PUBLIC_SITE_URL: "https://home.example/" }, "https://home.example"],
    [{ VERCEL_PROJECT_PRODUCTION_URL: "home.vercel.app" }, "https://home.vercel.app"],
    [{}, "http://localhost:3000"],
  ])("resolves %o to %s", (env, expected) => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    expect(siteUrl()).toBe(expected);
  });
});

describe("sitemap", () => {
  const urls = sitemap().map((e) => e.url);

  it.each(["/", "/board", "/etch", "/chatroom", "/terms"])("lists %s", (path) => {
    expect(urls).toContain(`${siteUrl()}${path === "/" ? "" : path}`);
  });

  it.each(POSTS.map((p) => p.slug))("lists chatroom/%s", (slug) => {
    expect(urls).toContain(`${siteUrl()}/chatroom/${slug}`);
  });
});
