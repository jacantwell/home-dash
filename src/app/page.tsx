import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start justify-center gap-6 px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">home-dash</h1>
      <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
        Little control panel for the house. Right now: push a message to the LED board.
      </p>
      <Link
        href="/board"
        className="rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
      >
        Open the board
      </Link>
    </main>
  );
}
