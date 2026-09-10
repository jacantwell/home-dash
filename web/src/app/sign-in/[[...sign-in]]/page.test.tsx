import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SignInPage from "./page";

describe("Sign-in page", () => {
  it("renders Clerk's sign-in at the /sign-in URL", () => {
    render(<SignInPage />);
    expect(screen.getByTestId("clerk-sign-in")).toBeInTheDocument();
  });
});
