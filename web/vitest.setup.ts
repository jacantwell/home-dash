import "@testing-library/jest-dom/vitest";

import { configure } from "@testing-library/react";
import { vi } from "vitest";

// findBy* defaults to 1s, which a loaded CI runner misses on the slower renders.
configure({ asyncUtilTimeout: 5000 });

// Clerk needs a real browser + keys; tests only need the surface we render.
vi.mock("@clerk/nextjs", async () => {
  const React = await import("react");
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return {
    ClerkProvider: passthrough,
    Show: passthrough,
    SignIn: () => React.createElement("div", { "data-testid": "clerk-sign-in" }),
    SignInButton: passthrough,
    SignUp: () => React.createElement("div", { "data-testid": "clerk-sign-up" }),
    SignUpButton: passthrough,
    UserButton: () => React.createElement("div", { "data-testid": "user-button" }),
    useAuth: vi.fn(() => ({
      isLoaded: true,
      isSignedIn: true,
      userId: "user_test",
      getToken: vi.fn(async () => "test-token"),
    })),
  };
});
