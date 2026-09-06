import "@testing-library/jest-dom/vitest";

import { vi } from "vitest";

// Clerk needs a real browser + keys; tests only need the surface we render.
vi.mock("@clerk/nextjs", async () => {
  const React = await import("react");
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return {
    ClerkProvider: passthrough,
    Show: passthrough,
    SignInButton: passthrough,
    UserButton: () => React.createElement("div", { "data-testid": "user-button" }),
    useAuth: vi.fn(() => ({
      isLoaded: true,
      isSignedIn: true,
      userId: "user_test",
      getToken: vi.fn(async () => "test-token"),
    })),
  };
});
