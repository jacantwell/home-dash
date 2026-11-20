"use client";

import { useState } from "react";

import { PixelIcon } from "@/components/pixel-icon";
import { Button, StatusBar } from "@/components/xp";
import { addDrinker, type Drinker, nextBuyer, recordRound, totalRounds } from "@/lib/rounds";

export function RoundsClient() {
  const [drinkers, setDrinkers] = useState<Drinker[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

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
    setDrinkers(drinkers.filter((_, i) => i !== index));
  }

  function reset() {
    setDrinkers([]);
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
            <Button className="mt-2" onClick={() => setDrinkers(recordRound(drinkers))}>
              {buyer.name} bought a round
            </Button>
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
