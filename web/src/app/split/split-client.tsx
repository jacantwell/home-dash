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
  const [presetTip, setPresetTip] = useState(0);
  const [customTip, setCustomTip] = useState<string | null>(null);

  const people = clampPeople(peopleText);
  const billPence = parsePounds(amount);
  const normalizedTip = customTip?.replaceAll(",", "") ?? null;
  const tip = normalizedTip === null ? presetTip : Number(normalizedTip);
  const invalidTip =
    normalizedTip !== null && (!/^\d+(?:\.\d{1,2})?$/.test(normalizedTip) || tip > 100);
  const split = billPence === null || invalidTip ? null : splitBill(billPence, people, tip);
  const invalid = amount.trim() !== "" && billPence === null;

  function reset() {
    setAmount("");
    setPeopleText(String(DEFAULT_PEOPLE));
    setPresetTip(0);
    setCustomTip(null);
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
        <span className="flex flex-wrap items-center gap-2">
          <select
            id="split-tip"
            className="xp-select"
            value={presetTip}
            disabled={customTip !== null}
            onChange={(e) => setPresetTip(Number(e.target.value))}
          >
            {TIP_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t === 0 ? "No tip" : `${t}%`}
              </option>
            ))}
          </select>
          <Button onClick={() => setCustomTip(customTip === null ? "" : null)}>
            {customTip === null ? "Custom tip" : "Use preset tips"}
          </Button>
          <Button onClick={reset}>Clear</Button>
        </span>
        {customTip !== null && (
          <>
            <label className="xp-hdr-label" htmlFor="split-custom-tip">
              Tip (%):
            </label>
            <input
              id="split-custom-tip"
              className="xp-field w-20"
              inputMode="decimal"
              autoComplete="off"
              placeholder="7,5"
              value={customTip}
              onChange={(e) => setCustomTip(e.target.value)}
              aria-invalid={customTip !== "" && invalidTip}
              aria-describedby={invalidTip && !invalid ? "split-tip-error" : undefined}
            />
          </>
        )}
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
        ) : invalidTip ? (
          <p id="split-tip-error">
            Enter a tip percentage from 0 to 100 with up to two decimal places.
          </p>
        ) : (
          <p>Enter the bill total to see what everyone pays.</p>
        )}
      </div>
      <StatusBar>
        <span>
          {people} {people === 1 ? "person" : "people"}
        </span>
        <span>{invalidTip ? "Custom tip" : tip === 0 ? "No tip" : `${tip}% tip`}</span>
      </StatusBar>
    </div>
  );
}
