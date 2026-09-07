import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatApacheDay } from "@/lib/time";

import { findPost, POSTS, roomLetter } from "../posts";
import { Comments } from "./comments";

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/blog/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const post = findPost(slug);
  return { title: post ? `${post.title} · home-dash` : "Not found · home-dash" };
}

export default async function PostPage({ params }: PageProps<"/blog/[slug]">) {
  const { slug } = await params;
  const post = findPost(slug);
  if (!post) notFound();
  const letter = roomLetter(post);

  return (
    <main className="raw mx-auto w-full max-w-4xl flex-1 px-4 pb-8">
      <p className="hatnote">
        <Link href="/blog">&larr; all rooms</Link>
      </p>

      <article>
        <h1>{post.title}</h1>
        <p className="pc-note-line">
          Chat Room {letter} &middot; <time dateTime={post.date}>{formatApacheDay(post.date)}</time>
        </p>
        <hr />
        {post.body.map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </article>

      <Comments slug={post.slug} room={letter} />

      <hr />
      <p>
        <Link href="/blog">Index of /blog</Link> &middot; <Link href="/">Index of /</Link>
      </p>
    </main>
  );
}
