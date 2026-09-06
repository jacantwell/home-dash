import { SignInButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";

import { BoardClient } from "./board-client";

export const metadata: Metadata = { title: "Board · home-dash" };

export default async function BoardPage() {
  const { userId } = await auth();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">LED board</h1>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          Whatever you send shows up on the board in the hallway.
        </p>
      </div>
      {userId ? (
        <BoardClient />
      ) : (
        <div className="flex flex-col items-start gap-4 rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
          <p>You need to sign in to post to the board.</p>
          <SignInButton mode="modal">
            <button
              type="button"
              className="rounded-full bg-zinc-950 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Sign in
            </button>
          </SignInButton>
        </div>
      )}
    </main>
  );
}
