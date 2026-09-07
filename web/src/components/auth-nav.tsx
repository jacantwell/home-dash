"use client";

import { Show, SignInButton, UserButton } from "@clerk/nextjs";

// Client-side so the sign-in state never forces a server render: imported from a client
// file, <Show> reads Clerk's browser state instead of awaiting auth() in the root layout.
export function AuthNav() {
  return (
    <span className="ml-auto flex items-center">
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button type="button" className="cursor-pointer underline">
            sign in
          </button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </span>
  );
}
