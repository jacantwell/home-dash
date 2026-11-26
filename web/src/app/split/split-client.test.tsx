import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SplitClient } from "./split-client";

function result() {
  return screen.getByRole("status", { name: "Result" });
}

async function fill(amount: string, people?: number, tip?: string) {
  const user = userEvent.setup();
  render(<SplitClient />);
  await user.type(screen.getByLabelText("Bill (£):"), amount);
  if (people !== undefined) {
    const field = screen.getByLabelText("People:");
    await user.clear(field);
    await user.type(field, String(people));
  }
  if (tip !== undefined) await user.selectOptions(screen.getByLabelText("Tip:"), tip);
  return user;
}

describe("SplitClient", () => {
  it("asks for the bill until one is entered", () => {
    render(<SplitClient />);
    expect(result()).toHaveTextContent("Enter the bill total to see what everyone pays.");
  });

  it.each([
    ["60", 2, "No tip", "Each pays £30.00", "Bill £60.00 = total £60.00"],
    ["31", 3, "No tip", "1 pays £10.34, 2 pay £10.33", "total £31.00"],
    ["40", 4, "12.5%", "Each pays £11.25", "Bill £40.00 + tip £5.00 = total £45.00"],
    ["19.99", 1, "10%", "You pay £21.99", "+ tip £2.00"],
  ])("splits £%s between %d with %s", async (amount, people, tip, shares, summary) => {
    await fill(amount, people, tip);
    expect(result()).toHaveTextContent(shares);
    expect(result()).toHaveTextContent(summary);
  });

  it.each([
    ["18", "2 pay £31.47, 1 pays £31.46", "total £94.40"],
    ["12.75", "2 pay £30.07, 1 pays £30.06", "total £90.20"],
    ["0", "2 pay £26.67, 1 pays £26.66", "total £80.00"],
  ])("splits £80 between three people with a custom %s%% tip", async (tip, shares, total) => {
    const user = await fill("80", 3);
    await user.click(screen.getByRole("button", { name: "Custom tip" }));
    await user.type(screen.getByLabelText("Tip (%):"), tip);
    expect(result()).toHaveTextContent(shares);
    expect(result()).toHaveTextContent(total);
  });

  it.each(["-1", "101", "12.345"])("rejects an invalid custom tip of %s", async (tip) => {
    const user = await fill("80");
    await user.click(screen.getByRole("button", { name: "Custom tip" }));
    const field = screen.getByLabelText("Tip (%):");
    await user.type(field, tip);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(result()).toHaveTextContent("Enter a tip percentage from 0 to 100");
    expect(result()).not.toHaveTextContent("Each pays");
  });

  it("recovers the selected preset and clears custom tip input", async () => {
    const user = await fill("80", 2, "10%");
    const custom = screen.getByRole("button", { name: "Custom tip" });
    await user.click(custom);
    await user.type(screen.getByLabelText("Tip (%):"), "18");
    await user.click(screen.getByRole("button", { name: "Use preset tips" }));
    expect(result()).toHaveTextContent("Each pays £44.00");

    await user.click(screen.getByRole("button", { name: "Custom tip" }));
    await user.type(screen.getByLabelText("Tip (%):"), "12");
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByLabelText("Tip (%):")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Tip:")).toHaveValue("0");
    expect(result()).toHaveTextContent("Enter the bill total");
  });

  it("flags an amount that isn't money", async () => {
    await fill("ten quid");
    expect(screen.getByLabelText("Bill (£):")).toHaveAttribute("aria-invalid", "true");
    expect(result()).toHaveTextContent("Enter the bill as an amount in pounds");
  });

  it("steps the head count with the buttons, within 1 to 20", async () => {
    const user = await fill("10");
    const people = screen.getByLabelText("People:");
    expect(screen.getByRole("button", { name: "One fewer person" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "One fewer person" }));
    expect(people).toHaveValue(1);
    expect(screen.getByRole("button", { name: "One fewer person" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "One more person" }));
    await user.click(screen.getByRole("button", { name: "One more person" }));
    expect(people).toHaveValue(3);
    expect(result()).toHaveTextContent("1 pays £3.34, 2 pay £3.33");
  });

  it("clears back to the defaults", async () => {
    const user = await fill("25", 5, "15%");
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByLabelText("Bill (£):")).toHaveValue("");
    expect(screen.getByLabelText("People:")).toHaveValue(2);
    expect(screen.getByLabelText("Tip:")).toHaveValue("0");
    expect(result()).toHaveTextContent("Enter the bill total");
  });
});
