import { SignInButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";

import { PixelIcon } from "@/components/pixel-icon";
import { Button, Window } from "@/components/xp";

import { EtchClient } from "./etch-client";

export const metadata: Metadata = {
  title: "Etch-A-Sketch · home-dash",
  description: "Draw on the LED board with two knobs. Messages and bus times draw over it.",
};

const MENU = ["File", "Edit", "View", "Shake", "Help"];

export default async function EtchPage() {
  const { userId } = await auth();

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
      <Window title="Etch-A-Sketch - Hallway" icon="board" menu={MENU}>
        {userId ? <EtchClient /> : <LogOn />}
      </Window>
    </main>
  );
}

function LogOn() {
  return (
    <div className="flex min-h-72 items-center justify-center bg-white p-6">
      <div className="xp-dialog" role="dialog" aria-labelledby="logon-title">
        <div className="xp-titlebar" style={{ height: 26 }}>
          <PixelIcon name="user" size={16} />
          <span className="title" id="logon-title">
            Log On to Etch-A-Sketch
          </span>
        </div>
        <div className="xp-dialog-body flex items-start gap-4">
          <PixelIcon name="user" size={32} />
          <p className="pt-1">You need to sign in before you can draw on the board.</p>
        </div>
        <div className="xp-dialog-actions">
          <SignInButton mode="modal">
            <Button className="default">Sign in...</Button>
          </SignInButton>
        </div>
      </div>
    </div>
  );
}
