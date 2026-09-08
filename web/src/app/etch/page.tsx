import type { Metadata } from "next";

import { Window } from "@/components/xp";

import { EtchClient } from "./etch-client";

export const metadata: Metadata = {
  title: "Etch-A-Sketch · home-dash",
  description: "Draw on the LED board with two knobs. Messages and bus times draw over it.",
};

const MENU = ["File", "Edit", "View", "Shake", "Help"];

export default function EtchPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
      <Window title="Etch-A-Sketch - Hallway" icon="board" menu={MENU}>
        <EtchClient />
      </Window>
    </main>
  );
}
