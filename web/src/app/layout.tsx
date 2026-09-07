import { ClerkProvider, Show, SignInButton, UserButton } from "@clerk/nextjs";
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "home-dash",
  description: "Home dashboard: send messages to the LED board and more.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider>
      <html lang="en" className="h-full">
        <body className="flex min-h-full flex-col">
          <header className="raw sitebar mx-auto w-full max-w-4xl px-4 pt-3">
            <nav className="flex items-center gap-2">
              <b>home-dash</b>
              <span aria-hidden>|</span>
              <Link href="/">index</Link>
              <span aria-hidden>&middot;</span>
              <Link href="/board">board</Link>
              <span aria-hidden>&middot;</span>
              <Link href="/blog">blog</Link>
              <span aria-hidden>&middot;</span>
              <Link href="/terms">terms</Link>
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
            </nav>
            <hr />
          </header>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
