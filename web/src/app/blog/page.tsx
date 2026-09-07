import type { Metadata } from "next";
import Link from "next/link";

import { PixelIcon } from "@/components/pixel-icon";

import { POSTS_NEWEST_FIRST, roomLetter } from "./posts";

export const metadata: Metadata = {
  title: "Blog · home-dash",
  description: "Notes from the house. Anyone can reply; replies vanish after seven days.",
};

export default function BlogPage() {
  return (
    <main className="raw mx-auto w-full max-w-4xl flex-1 px-4 pb-8">
      <h1>Blog</h1>
      <p>
        One post per chat room. Replies are anonymous and are wiped after seven days, so nothing
        here is forever.
      </p>

      <div className="pc-ds">
        <div className="pc-screen pc-top">
          <div className="pc-logo" aria-hidden>
            <PixelIcon name="pencil" size={18} />
            <span>PictoChat</span>
          </div>
          <p className="pc-hint">Please select a chat room.</p>
        </div>
        <div className="pc-hinge" aria-hidden />
        <div className="pc-screen pc-bottom">
          <nav aria-label="Chat rooms" className="pc-rooms">
            {POSTS_NEWEST_FIRST.map((post) => (
              <Link key={post.slug} href={`/blog/${post.slug}`} className="pc-room">
                <span className="pc-room-letter" aria-hidden>
                  {roomLetter(post)}
                </span>
                <span className="pc-room-body">
                  <span className="pc-room-name">Chat Room {roomLetter(post)}</span>
                  <span className="pc-room-title">{post.title}</span>
                </span>
                <time className="pc-room-meta" dateTime={post.date}>
                  {post.date}
                </time>
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <p>
        <Link href="/">Index of /</Link>
      </p>
    </main>
  );
}
