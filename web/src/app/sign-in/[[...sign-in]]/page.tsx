import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";

export const metadata: Metadata = {
  title: "Sign in · home-dash",
  description: "Sign in to home-dash.",
};

// Dedicated sign-in URL so automated explorations (Duku) can start here
// instead of driving the header modal.
export default function SignInPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 items-start justify-center px-4 py-10">
      <SignIn />
    </main>
  );
}
