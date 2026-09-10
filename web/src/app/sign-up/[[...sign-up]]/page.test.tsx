import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SignUpPage from "./page";

describe("Sign-up page", () => {
  it("renders Clerk's sign-up at the /sign-up URL", () => {
    render(<SignUpPage />);
    expect(screen.getByTestId("clerk-sign-up")).toBeInTheDocument();
  });
});
