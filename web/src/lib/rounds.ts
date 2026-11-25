// Whose round is it: the person who has bought the fewest, earliest added on a tie.

export const MAX_PEOPLE = 20;
export const MAX_NAME_LENGTH = 30;

export interface Drinker {
  name: string;
  rounds: number;
}

// Trims and collapses spaces; null when empty or too long.
export function normaliseName(input: string): string | null {
  const name = input.trim().replace(/\s+/g, " ");
  if (name === "" || name.length > MAX_NAME_LENGTH) return null;
  return name;
}

export type AddResult = { ok: true; drinkers: Drinker[] } | { ok: false; reason: string };

export function addDrinker(drinkers: Drinker[], input: string): AddResult {
  const name = normaliseName(input);
  if (name === null) return { ok: false, reason: `Names are 1 to ${MAX_NAME_LENGTH} characters.` };
  if (drinkers.length >= MAX_PEOPLE) return { ok: false, reason: `That's ${MAX_PEOPLE} already.` };
  const existing = drinkers.find((d) => d.name.toLowerCase() === name.toLowerCase());
  if (existing) return { ok: false, reason: `${existing.name} is already out.` };
  return { ok: true, drinkers: [...drinkers, { name, rounds: 0 }] };
}

export function nextBuyer(drinkers: Drinker[]): number | null {
  if (drinkers.length === 0) return null;
  return drinkers.reduce((best, d, i) => (d.rounds < drinkers[best].rounds ? i : best), 0);
}

export function recordRound(drinkers: Drinker[]): Drinker[] {
  const next = nextBuyer(drinkers);
  if (next === null) return drinkers;
  return drinkers.map((d, i) => (i === next ? { ...d, rounds: d.rounds + 1 } : d));
}

export function totalRounds(drinkers: Drinker[]): number {
  return drinkers.reduce((sum, d) => sum + d.rounds, 0);
}
