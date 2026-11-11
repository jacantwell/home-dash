// Bill splitting in whole pence, so the shares always add back up to the total.

export const MIN_PEOPLE = 1;
export const MAX_PEOPLE = 20;
export const TIP_OPTIONS = [0, 10, 12.5, 15, 20] as const;

export interface Share {
  count: number;
  pence: number;
}

export interface Split {
  billPence: number;
  tipPence: number;
  totalPence: number;
  shares: Share[];
}

// "12.5", "£12.50" or "1,234" -> pence; null for anything that isn't a positive amount.
export function parsePounds(input: string): number | null {
  const cleaned = input.trim().replace(/^£/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const pence = Math.round(Number(cleaned) * 100);
  return pence > 0 ? pence : null;
}

export function splitBill(billPence: number, people: number, tipPercent: number): Split {
  const tipPence = Math.round((billPence * tipPercent) / 100);
  const totalPence = billPence + tipPence;
  const base = Math.floor(totalPence / people);
  const extra = totalPence % people;
  const shares: Share[] = [];
  if (extra > 0) shares.push({ count: extra, pence: base + 1 });
  if (people - extra > 0) shares.push({ count: people - extra, pence: base });
  return { billPence, tipPence, totalPence, shares };
}

export function formatPounds(pence: number): string {
  const pounds = Math.floor(pence / 100).toLocaleString("en-GB");
  return `£${pounds}.${String(pence % 100).padStart(2, "0")}`;
}

// "Each pays £10.00", or "2 pay £10.34, 1 pays £10.33" when a penny is left over.
export function describeShares(shares: Share[]): string {
  if (shares.length === 1) {
    const [only] = shares;
    return only.count === 1
      ? `You pay ${formatPounds(only.pence)}`
      : `Each pays ${formatPounds(only.pence)}`;
  }
  return shares
    .map((s) => `${s.count} ${s.count === 1 ? "pays" : "pay"} ${formatPounds(s.pence)}`)
    .join(", ");
}
