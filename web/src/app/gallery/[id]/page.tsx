import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";

import { LogOn } from "@/components/log-on";
import { Window } from "@/components/xp";

import { AlbumClient } from "./album-client";

export const metadata: Metadata = { title: "Album · My Pictures · home-dash" };

const MENU = ["File", "Edit", "View", "Favorites", "Tools", "Help"];

export default async function AlbumPage(props: PageProps<"/gallery/[id]">) {
  const { id } = await props.params;
  const { userId } = await auth();
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
      <Window title="My Pictures" icon="picture" menu={MENU}>
        {userId ? (
          <AlbumClient albumId={id} />
        ) : (
          <LogOn app="My Pictures" message="You need to sign in to see the house albums." />
        )}
      </Window>
    </main>
  );
}
