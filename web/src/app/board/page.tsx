import { SignInButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";

import { PixelIcon } from "@/components/pixel-icon";
import { Button, Window } from "@/components/xp";

import { BoardClient } from "./board-client";

export const metadata: Metadata = { title: "LED Board · home-dash" };

const MENU = ["File", "Edit", "View", "Tools", "Message", "Help"];

export default async function BoardPage() {
  const { userId } = await auth();

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
      <Window title="LED Board - Hallway" icon="envelope" menu={MENU}>
        {userId ? <BoardClient /> : <LogOn />}
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
            Log On to LED Board
          </span>
        </div>
        <div className="xp-dialog-body flex items-start gap-4">
          <PixelIcon name="user" size={32} />
          <p className="pt-1">You need to sign in before you can post to the board.</p>
        </div>
        <div className="xp-dialog-actions">
          <SignInButton mode="redirect">
            <Button className="default">Sign in...</Button>
          </SignInButton>
        </div>
      </div>
    </div>
  );
}
