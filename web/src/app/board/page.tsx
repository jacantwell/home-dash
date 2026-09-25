import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";

import { LogOn } from "@/components/log-on";
import { Window } from "@/components/xp";

import { BoardClient } from "./board-client";

export const metadata: Metadata = { title: "LED Board · home-dash" };

const MENU = ["File", "Edit", "View", "Tools", "Message", "Help"];

export default async function BoardPage() {
  const { userId } = await auth();

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
      <Window title="LED Board - Hallway" icon="envelope" menu={MENU}>
        {userId ? (
          <BoardClient />
        ) : (
          <LogOn app="LED Board" message="You need to sign in before you can post to the board." />
        )}
      </Window>
    </main>
  );
}
