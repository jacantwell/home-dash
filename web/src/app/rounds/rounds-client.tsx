"use client";

import { useState } from "react";

import { PixelIcon } from "@/components/pixel-icon";
import { Button, StatusBar } from "@/components/xp";
import {
  addDrinker,
  type Drinker,
  nextBuyer,
  recordRound,
  totalRounds,
  undoRound,
} from "@/lib/rounds";

export function RoundsClient() {
  const [drinkers, setDrinkers] = useState<Drinker[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Who bought each round, oldest first, so Undo takes back the latest.
  const [history, setHistory] = useState<string[]>([]);

  const next = nextBuyer(drinkers);
  const buyer = next === null ? null : drinkers[next];
  const total = totalRounds(drinkers);

  function add(e: React.FormEvent) {
    e.preventDefault();
    const result = addDrinker(drinkers, name);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setDrinkers(result.drinkers);
    setName("");
    setError(null);
  }

  function remove(index: number) {
    const gone = drinkers[index].name;
    setDrinkers(drinkers.filter((_, i) => i !== index));
    setHistory(history.filter((n) => n !== gone));
  }

  function buy() {
    if (!buyer) return;
    setDrinkers(recordRound(drinkers));
    setHistory([...history, buyer.name]);
  }

  function undo() {
    const last = history[0];
    if (last === undefined) return;
    setDrinkers(undoRound(drinkers, last));
    setHistory(history.slice(1));
  }

  function reset() {
    setDrinkers([]);
    setHistory([]);
    setName("");
    setError(null);
  }

  return (
    <div>
      <form className="xp-hdr" onSubmit={add}>
        <label className="xp-hdr-label" htmlFor="rounds-name">
          Name:
        </label>
        <span className="flex items-center gap-2">
          <input
            id="rounds-name"
            className="xp-field"
            autoComplete="off"
            placeholder="Sam"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={error !== null}
            aria-describedby={error ? "rounds-name-error" : undefined}
          />
          <Button type="submit">Add</Button>
          <Button onClick={reset}>Clear</Button>
        </span>
      </form>
      {error && (
        <p id="rounds-name-error" className="px-3 pt-2" role="alert">
          {error}
        </p>
      )}

      <div className="xp-pane-title">
        <PixelIcon name="check" size={16} />
        Whose round?
      </div>
      <div className="px-3 py-4" role="status" aria-label="Whose round">
        {buyer ? (
          <>
            <p className="text-lg font-bold">It&apos;s {buyer.name}&apos;s round</p>
            <span className="mt-2 flex items-center gap-2">
              <Button onClick={buy}>{buyer.name} bought a round</Button>
              {history.length > 0 && (
                <Button onClick={undo}>Undo {history.at(-1)}&apos;s round</Button>
              )}
            </span>
          </>
        ) : (
          <p>Add who&apos;s out to see whose round it is.</p>
        )}
      </div>

      {drinkers.length > 0 && (
        <ul className="px-3 pb-4" aria-label="Rounds bought">
          {drinkers.map((d, i) => (
            <li key={d.name} className="flex items-center gap-2 py-1">
              <span className="w-40">{d.name}</span>
              <span className="w-24">
                {d.rounds} {d.rounds === 1 ? "round" : "rounds"}
              </span>
              <Button aria-label={`Remove ${d.name}`} onClick={() => remove(i)}>
                x
              </Button>
            </li>
          ))}
        </ul>
      )}

      <StatusBar>
        <span>
          {drinkers.length} {drinkers.length === 1 ? "person" : "people"} out
        </span>
        <span>
          {total} {total === 1 ? "round" : "rounds"} bought
        </span>
      </StatusBar>
    </div>
  );
}
