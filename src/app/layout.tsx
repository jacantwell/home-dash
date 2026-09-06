import { ClerkProvider, Show, SignInButton, UserButton } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "home-dash",
  description: "Home dashboard: send messages to the LED board and more.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
        <body className="flex min-h-full flex-col font-sans">
          <header className="border-b border-zinc-200 dark:border-zinc-800">
            <nav className="mx-auto flex w-full max-w-3xl items-center gap-6 px-6 py-3">
              <Link href="/" className="font-semibold tracking-tight">
                home-dash
              </Link>
              <Link
                href="/board"
                className="text-sm text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
              >
                Board
              </Link>
              <div className="ml-auto flex items-center">
                <Show when="signed-out">
                  <SignInButton mode="modal">
                    <button
                      type="button"
                      className="rounded-full bg-zinc-950 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                    >
                      Sign in
                    </button>
                  </SignInButton>
                </Show>
                <Show when="signed-in">
                  <UserButton />
                </Show>
              </div>
            </nav>
          </header>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
