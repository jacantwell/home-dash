import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";

import { LogOn } from "@/components/log-on";
import { Window } from "@/components/xp";

import { CalendarClient } from "./calendar-client";

export const metadata: Metadata = {
  title: "Calendar · home-dash",
  description: "Upcoming house events. New ones show up on the hallway board.",
};

const MENU = ["File", "Edit", "View", "Go", "Actions", "Help"];

export default async function CalendarPage() {
  const { userId } = await auth();

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
      <Window title="Appointment - House Calendar" icon="calendar" menu={MENU}>
        {userId ? (
          <CalendarClient />
        ) : (
          <LogOn app="House Calendar" message="You need to sign in to see and add house events." />
        )}
      </Window>
    </main>
  );
}
