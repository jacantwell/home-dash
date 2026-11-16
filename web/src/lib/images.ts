import { MAX_ORIGINAL_BYTES, ORIGINAL_TYPES } from "./api";

// Renditions the browser makes before upload; the original is kept as-is.
export const DISPLAY_MAX_PX = 2048;
export const THUMB_MAX_PX = 480;
const JPEG_QUALITY = { display: 0.85, thumb: 0.8 } as const;

export interface Size {
  width: number;
  height: number;
}

export interface PreparedImage extends Size {
  contentType: string;
  display: Blob;
  thumb: Blob;
}

export class ImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageError";
  }
}

/** Scale down (never up) so the longest side is at most `max`. */
export function fitWithin({ width, height }: Size, max: number): Size {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

const EXTENSION_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
  gif: "image/gif",
};

/** The file's MIME type, falling back to its extension (HEICs often arrive untyped). */
export function photoContentType(file: Pick<File, "name" | "type">): string | null {
  const type = file.type.toLowerCase();
  if ((ORIGINAL_TYPES as readonly string[]).includes(type)) return type;
  if (type) return null;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TYPES[ext] ?? null;
}

async function render(bitmap: ImageBitmap, max: number, quality: number): Promise<Blob> {
  const size = fitWithin(bitmap, max);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageError("This browser can't draw images");
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) throw new ImageError("Couldn't encode the image");
  return blob;
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const contentType = photoContentType(file);
  if (!contentType) throw new ImageError(`${file.name} isn't a supported photo`);
  if (file.size > MAX_ORIGINAL_BYTES) throw new ImageError(`${file.name} is bigger than 50 MB`);
  let bitmap: ImageBitmap;
  try {
    // applies EXIF orientation, so renditions come out the right way up
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ImageError(`This browser can't open ${file.name}`);
  }
  try {
    const [display, thumb] = await Promise.all([
      render(bitmap, DISPLAY_MAX_PX, JPEG_QUALITY.display),
      render(bitmap, THUMB_MAX_PX, JPEG_QUALITY.thumb),
    ]);
    return { width: bitmap.width, height: bitmap.height, contentType, display, thumb };
  } finally {
    bitmap.close();
  }
}
