import type { Metadata } from "next";

import { Window } from "@/components/xp";

import { SplitClient } from "./split-client";

export const metadata: Metadata = {
  title: "Split the bill · home-dash",
  description: "Split a bill between housemates, tip included, down to the penny.",
};

const MENU = ["File", "Edit", "View", "Help"];

export default function SplitPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
      <Window title="Split the bill - Calculator" icon="document" menu={MENU}>
        <SplitClient />
      </Window>
    </main>
  );
}
