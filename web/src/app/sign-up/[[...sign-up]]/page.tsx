import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";

export const metadata: Metadata = {
  title: "Sign up · home-dash",
  description: "Create a home-dash account.",
};

// Companion to /sign-in: Clerk's sign-in card links here for new accounts.
export default function SignUpPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 items-start justify-center px-4 py-10">
      <SignUp />
    </main>
  );
}
