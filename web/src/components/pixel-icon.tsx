import type { CSSProperties } from "react";

// Icons are drawn as character grids; one character per pixel, "." is transparent.
const PALETTE: Record<string, string> = {
  "#": "#1f1f1f",
  W: "#ffffff",
  w: "#e6e6e6",
  Y: "#f7d46b",
  y: "#d9a42e",
  B: "#3d6fcf",
  S: "#f3c9a5",
  G: "#2fa83a",
  R: "#d6321e",
  O: "#ff8c00",
  K: "#000000",
  g: "#5c5c5c",
};

export const ICONS = {
  envelope: `
.##############.
.#W#wwwwwwww#W#.
.#WW#wwwwww#WW#.
.#WWW#wwww#WWW#.
.#WWWW#ww#WWWW#.
.#WWWWW##WWWWW#.
.#WWWWWWWWWWWW#.
.#WWWWWWWWWWWW#.
.##############.`,
  folder: `
.######.........
.#YYYYY#........
.##############.
.#yYYYYYYYYYYY#.
.#yYYYYYYYYYYY#.
.#yYYYYYYYYYYY#.
.#yYYYYYYYYYYY#.
.#yYYYYYYYYYYY#.
.#yYYYYYYYYYYY#.
.##############.`,
  document: `
.#########......
.#WWWWWWW##.....
.#WWWWWWW#W#....
.#WWWWWWW#WW#...
.#WWWWWWW#####..
.#Wgggggg#WWW#..
.#WWWWWWWWWWW#..
.#WggggggggWW#..
.#WWWWWWWWWWW#..
.#WggggggggWW#..
.#WWWWWWWWWWW#..
.#WgggggWWWWW#..
.#WWWWWWWWWWW#..
.#############..`,
  board: `
gggggggggggggggg
gKKKKKKKKKKKKKKg
gKOKOKKOOKKOKOKg
gKOKOKKOKOKOKOKg
gKOOOKKOKOKKOKKg
gKOKOKKOOKKKOKKg
gKKKKKKKKKKKKKKg
gggggggggggggggg`,
  user: `
......####......
.....#SSSS#.....
.....#SSSS#.....
.....#SSSS#.....
......####......
....#BBBBBB#....
...#BBBBBBBB#...
..#BBBBBBBBBB#..
..#BBBBBBBBBB#..
..#BBBBBBBBBB#..
..############..`,
  check: `
..........GG
.........GGG
........GGG.
GG.....GGG..
GGG...GGG...
.GGG.GGG....
..GGGGG.....
...GGG......
....G.......`,
  error: `
....######....
..##RRRRRR##..
.#RRRRRRRRRR#.
.#RRWRRRRWRR#.
#RRRWWRRWWRRR#
#RRRRWWWWRRRR#
#RRRRRWWRRRRR#
#RRRRRWWRRRRR#
#RRRRWWWWRRRR#
#RRRWWRRWWRRR#
.#RRWRRRRWRR#.
.#RRRRRRRRRR#.
..##RRRRRR##..
....######....`,
  pencil: `
..........###...
.........#RRR#..
........#RRRR#..
.......#YY#R#...
......#YYY##....
.....#YYY#......
....#YYY#.......
...#YYY#........
..#YYY#.........
.#SS#Y#.........
.#SSS##.........
.####...........`,
  refresh: `
...GGGGGG....
..G......G.G.
.G........GG.
.G.......GGG.
.............
.GGG.......G.
.GG........G.
.G.G......G..
....GGGGGG...`,
} as const;

export type IconName = keyof typeof ICONS;

interface Props {
  name: IconName;
  /** Rendered width in px; height follows the grid's aspect ratio. */
  size?: number;
  label?: string;
  className?: string;
  style?: CSSProperties;
}

export function PixelIcon({ name, size, label, className, style }: Props) {
  const rows = ICONS[name].trim().split("\n");
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const width = size ?? w;
  const height = Math.round((width * h) / w);

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={width}
      height={height}
      shapeRendering="crispEdges"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className ? `px ${className}` : "px"}
      style={style}
    >
      {rows.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === "." ? null : (
            <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={PALETTE[c]} />
          ),
        ),
      )}
    </svg>
  );
}
