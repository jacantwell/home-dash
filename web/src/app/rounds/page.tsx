import type { Metadata } from "next";

import { Window } from "@/components/xp";

import { RoundsClient } from "./rounds-client";

export const metadata: Metadata = {
  title: "Whose round? · home-dash",
  description: "Keep track of who's bought a round at the pub, and whose turn it is next.",
};

const MENU = ["File", "Edit", "View", "Help"];

export default function RoundsPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
      <Window title="Whose round? - Tracker" icon="document" menu={MENU}>
        <RoundsClient />
      </Window>
    </main>
  );
}
