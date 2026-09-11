import type { MetadataRoute } from "next";

import { POSTS } from "./chatroom/posts";

const STATIC = ["", "/board", "/etch", "/chatroom", "/terms"] as const;

export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercel ? `https://${vercel}` : "http://localhost:3000";
}

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return [
    ...STATIC.map((path) => ({ url: `${base}${path}` })),
    ...POSTS.map((p) => ({ url: `${base}/chatroom/${p.slug}`, lastModified: new Date(p.date) })),
  ];
}
