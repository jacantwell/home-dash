export const WIKI = "https://en.wikipedia.org/wiki/";

// Wikipedia-style: every claim gets a footnote, whether or not the footnote helps.
export const REFERENCES = [
  {
    id: 1,
    text: "Darwin, C. (1881). The Formation of Vegetable Mould through the Action of Worms.",
  },
  { id: 2, text: "Personal communication with a worm, 2004. The worm declined to be named." },
  { id: 3, text: "Figure derived from an unlabelled graph found in the garage." },
  { id: 4, text: "Vibes." },
  { id: 5, text: "The Worm Council did not respond to a request for comment." },
] as const;

export type RefId = (typeof REFERENCES)[number]["id"];

export const SECTIONS = [
  { id: "definitions", title: "Definitions" },
  { id: "acceptance", title: "Acceptance of Terms" },
  { id: "the-worms", title: "The Worms" },
  { id: "your-obligations", title: "Your Obligations" },
  { id: "the-board", title: "The Board" },
  { id: "liability", title: "Limitation of Liability" },
  { id: "termination", title: "Termination and Segmentation" },
  { id: "governing-law", title: "Governing Law" },
  { id: "references", title: "References" },
] as const;
