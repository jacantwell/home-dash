import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";

import { Window } from "@/components/xp";

import { SpritesClient } from "./sprites-client";

export const metadata: Metadata = {
  title: "Sprite Maker · home-dash",
  description: "Draw 16x16 pixel-art sprites and save them to the house catalog.",
};

const MENU = ["File", "Edit", "View", "Image", "Colors", "Help"];

export default async function SpritesPage() {
  const { userId } = await auth();
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
      <Window title="untitled - Sprite Maker" icon="pencil" menu={MENU}>
        <SpritesClient signedIn={Boolean(userId)} />
      </Window>
    </main>
  );
}
