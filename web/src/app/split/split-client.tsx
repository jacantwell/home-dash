"use client";

import { useState } from "react";

import { PixelIcon } from "@/components/pixel-icon";
import { Button, StatusBar } from "@/components/xp";
import {
  describeShares,
  formatPounds,
  MAX_PEOPLE,
  MIN_PEOPLE,
  parsePounds,
  splitBill,
  TIP_OPTIONS,
} from "@/lib/split";

const DEFAULT_PEOPLE = 2;

// The field can be mid-edit (empty, "0"); the split uses the nearest valid head count.
function clampPeople(text: string): number {
  const n = Number(text);
  if (text.trim() === "" || !Number.isFinite(n)) return DEFAULT_PEOPLE;
  return Math.min(MAX_PEOPLE, Math.max(MIN_PEOPLE, Math.round(n)));
}

export function SplitClient() {
  const [amount, setAmount] = useState("");
  const [peopleText, setPeopleText] = useState(String(DEFAULT_PEOPLE));
  const [tip, setTip] = useState(0);

  const people = clampPeople(peopleText);
  const billPence = parsePounds(amount);
  const split = billPence === null ? null : splitBill(billPence, people, tip);
  const invalid = amount.trim() !== "" && billPence === null;

  function reset() {
    setAmount("");
    setPeopleText(String(DEFAULT_PEOPLE));
    setTip(0);
  }

  return (
    <div>
      <form className="xp-hdr" onSubmit={(e) => e.preventDefault()}>
        <label className="xp-hdr-label" htmlFor="split-amount">
          Bill (£):
        </label>
        <input
          id="split-amount"
          className="xp-field"
          inputMode="decimal"
          autoComplete="off"
          placeholder="42.50"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-invalid={invalid}
          aria-describedby={invalid ? "split-amount-error" : undefined}
        />
        <label className="xp-hdr-label" htmlFor="split-people">
          People:
        </label>
        <span className="flex items-center gap-2">
          <Button
            aria-label="One fewer person"
            onClick={() => setPeopleText(String(clampPeople(String(people - 1))))}
            disabled={people <= MIN_PEOPLE}
          >
            -
          </Button>
          <input
            id="split-people"
            type="number"
            className="xp-field w-16"
            min={MIN_PEOPLE}
            max={MAX_PEOPLE}
            value={peopleText}
            onChange={(e) => setPeopleText(e.target.value)}
            onBlur={() => setPeopleText(String(people))}
          />
          <Button
            aria-label="One more person"
            onClick={() => setPeopleText(String(clampPeople(String(people + 1))))}
            disabled={people >= MAX_PEOPLE}
          >
            +
          </Button>
        </span>
        <label className="xp-hdr-label" htmlFor="split-tip">
          Tip:
        </label>
        <span className="flex items-center gap-2">
          <select
            id="split-tip"
            className="xp-select"
            value={tip}
            onChange={(e) => setTip(Number(e.target.value))}
          >
            {TIP_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t === 0 ? "No tip" : `${t}%`}
              </option>
            ))}
          </select>
          <Button onClick={reset}>Clear</Button>
        </span>
      </form>

      <div className="xp-pane-title">
        <PixelIcon name="check" size={16} />
        Result
      </div>
      <div className="px-3 py-4" role="status" aria-label="Result">
        {split ? (
          <>
            <p className="text-lg font-bold">{describeShares(split.shares)}</p>
            <p>
              Bill {formatPounds(split.billPence)}
              {split.tipPence > 0 && <> + tip {formatPounds(split.tipPence)}</>} = total{" "}
              {formatPounds(split.totalPence)}
            </p>
          </>
        ) : invalid ? (
          <p id="split-amount-error">Enter the bill as an amount in pounds, like 42.50.</p>
        ) : (
          <p>Enter the bill total to see what everyone pays.</p>
        )}
      </div>
      <StatusBar>
        <span>
          {people} {people === 1 ? "person" : "people"}
        </span>
        <span>{tip === 0 ? "No tip" : `${tip}% tip`}</span>
      </StatusBar>
    </div>
  );
}
