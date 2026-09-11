import type { CSSProperties } from "react";

import { paletteColor, type Sprite } from "@/lib/api";

interface Props {
  sprite: Pick<Sprite, "w" | "h" | "pixels">;
  /** Rendered width in px; height follows the grid. */
  size?: number;
  label?: string;
  className?: string;
  style?: CSSProperties;
}

// Same trick as PixelIcon: one crisp <rect> per lit cell.
export function SpriteImage({ sprite, size, label, className, style }: Props) {
  const { w, h, pixels } = sprite;
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
      {[...pixels].map((c, i) => {
        const fill = paletteColor(c);
        if (!fill) return null;
        return <rect key={i} x={i % w} y={Math.floor(i / w)} width={1} height={1} fill={fill} />;
      })}
    </svg>
  );
}
