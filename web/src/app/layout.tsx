import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

import { AuthNav } from "@/components/auth-nav";

export const metadata: Metadata = {
  title: "home-dash",
  description: "Home dashboard: send messages to the LED board and more.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up">
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
              <Link href="/etch">etch</Link>
              <span aria-hidden>&middot;</span>
              <Link href="/chatroom">chatroom</Link>
              <span aria-hidden>&middot;</span>
              <Link href="/sprites">sprites</Link>
              <span aria-hidden>&middot;</span>
              <Link href="/terms">terms</Link>
              <AuthNav />
            </nav>
            <hr />
          </header>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
