import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";

import { LogOn } from "@/components/log-on";
import { Window } from "@/components/xp";

import { GalleryClient } from "./gallery-client";

export const metadata: Metadata = {
  title: "My Pictures · home-dash",
  description: "The house photo albums.",
};

const MENU = ["File", "Edit", "View", "Favorites", "Tools", "Help"];

export default async function GalleryPage() {
  const { userId } = await auth();
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
      <Window title="My Pictures - Gallery" icon="picture" menu={MENU}>
        {userId ? (
          <GalleryClient />
        ) : (
          <LogOn app="My Pictures" message="You need to sign in to see the house albums." />
        )}
      </Window>
    </main>
  );
}
