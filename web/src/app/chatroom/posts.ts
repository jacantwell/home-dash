// Posts are plain data: add one here and it shows up as a chat room on /chatroom.
// Slugs must match the api's pattern: lowercase, digits and single dashes.
export interface Post {
  slug: string;
  title: string;
  /** ISO date, shown as-is and used for ordering (newest first). */
  date: string;
  /** One paragraph per entry. */
  body: string[];
}

export const POSTS: readonly Post[] = [
  {
    slug: "hello-world",
    title: "hello, world",
    date: "2026-09-01",
    body: [
      "These are the home-dash chat rooms. They live next to the LED board and the worm terms, and they work like PictoChat: pick a room, read the note, scribble a reply.",
      "You don't need an account. Every reply is anonymous, and every reply is wiped after seven days, so say what you like as long as you can live with it for a week.",
      "Pick a pen colour. It's the only thing about you the page remembers, and it only remembers it in your own browser.",
    ],
  },
  {
    slug: "the-board-is-live",
    title: "the board is live",
    date: "2026-09-04",
    body: [
      "The LED board in the hallway now takes messages from the internet. Sign in, type something, pick a colour, and it scrolls past the coats within a second or two.",
      "Messages are capped at 60 seconds because that is the attention span of a worm (see the terms). Anything longer and the board starts to look like a stock ticker.",
      "If it fails, the board page tells you why. Usually the Pi has fallen off the wifi again.",
    ],
  },
  {
    slug: "on-worms",
    title: "on worms",
    date: "2026-09-06",
    body: [
      "Several people have asked why the terms and conditions are about worms. The honest answer is that nobody reads terms and conditions, so they may as well be about something with five hearts.",
      "The less honest answer is that the worms asked for it.",
    ],
  },
];

export const POSTS_NEWEST_FIRST: readonly Post[] = [...POSTS].sort((a, b) =>
  b.date.localeCompare(a.date),
);

export function findPost(slug: string): Post | undefined {
  return POSTS.find((p) => p.slug === slug);
}

/** PictoChat rooms are lettered; posts get a letter by publish order so it never changes. */
export function roomLetter(post: Post): string {
  const chronological = [...POSTS].sort((a, b) => a.date.localeCompare(b.date));
  return String.fromCharCode(65 + chronological.findIndex((p) => p.slug === post.slug));
}
