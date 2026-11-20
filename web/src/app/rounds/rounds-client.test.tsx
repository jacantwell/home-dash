import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { RoundsClient } from "./rounds-client";

function status() {
  return screen.getByRole("status", { name: "Whose round" });
}

async function setup(...names: string[]) {
  const user = userEvent.setup();
  render(<RoundsClient />);
  for (const name of names) {
    await user.type(screen.getByLabelText("Name:"), name);
    await user.click(screen.getByRole("button", { name: "Add" }));
  }
  return user;
}

describe("RoundsClient", () => {
  it("asks who's out until someone is added", () => {
    render(<RoundsClient />);
    expect(status()).toHaveTextContent("Add who's out to see whose round it is.");
  });

  it.each([
    [0, "It's Sam's round", "0 rounds bought"],
    [1, "It's Alex's round", "1 round bought"],
    [2, "It's Jo's round", "2 rounds bought"],
    [3, "It's Sam's round", "3 rounds bought"],
  ])("after %d rounds: %s", async (rounds, expected, footer) => {
    const user = await setup("Sam", "Alex", "Jo");
    for (let i = 0; i < rounds; i++) {
      const buyer = /bought a round$/;
      await user.click(screen.getByRole("button", { name: buyer }));
    }
    expect(status()).toHaveTextContent(expected);
    expect(screen.getByText(footer)).toBeInTheDocument();
  });

  it.each([
    ["sam", "Sam is already out."],
    ["   ", "Names are 1 to 24 characters."],
  ])("refuses %j", async (name, reason) => {
    const user = await setup("Sam");
    await user.type(screen.getByLabelText("Name:"), name);
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent(reason);
    expect(screen.getByLabelText("Name:")).toHaveAttribute("aria-invalid", "true");
  });

  it("removes someone and moves the round on", async () => {
    const user = await setup("Sam", "Alex");
    await user.click(screen.getByRole("button", { name: "Remove Sam" }));
    expect(status()).toHaveTextContent("It's Alex's round");
    expect(screen.getByText("1 person out")).toBeInTheDocument();
  });

  it("clears everyone", async () => {
    const user = await setup("Sam", "Alex");
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(status()).toHaveTextContent("Add who's out");
    expect(screen.getByText("0 people out")).toBeInTheDocument();
  });
});
