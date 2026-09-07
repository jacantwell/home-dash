import type { Metadata } from "next";
import Link from "next/link";

import { PixelIcon } from "@/components/pixel-icon";
import { formatApacheDay } from "@/lib/time";

import { POSTS_NEWEST_FIRST, roomLetter } from "./posts";

export const metadata: Metadata = {
  title: "Blog · home-dash",
  description: "Notes from the house. Anyone can reply; replies vanish after seven days.",
};

export default function BlogPage() {
  return (
    <main className="raw mx-auto w-full max-w-4xl flex-1 px-4 pb-8">
      <h1>Index of /blog</h1>
      <p>
        One post per chat room. Replies are anonymous and are wiped after seven days, so nothing
        here is forever.
      </p>
      <p>
        <b>Please select a chat room.</b>
      </p>
      <table>
        <caption>Chat rooms</caption>
        <thead>
          <tr>
            <th>Room</th>
            <th>Name</th>
            <th>Last modified</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {POSTS_NEWEST_FIRST.map((post) => (
            <tr key={post.slug}>
              <td className="pc-letter">[{roomLetter(post)}]</td>
              <td>
                <PixelIcon name="pencil" size={16} label="note" />{" "}
                <Link href={`/blog/${post.slug}`}>{post.slug}</Link>
              </td>
              <td>
                <time dateTime={post.date}>{formatApacheDay(post.date)}</time>
              </td>
              <td>{post.title}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <hr />
      <p>
        <Link href="/">Index of /</Link>
      </p>
    </main>
  );
}
