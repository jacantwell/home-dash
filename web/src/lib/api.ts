// Types mirror the backend contract (backend/README.md).
export type MessageStatus = "sent" | "failed";

export interface Message {
  id: number;
  text: string;
  color: string | null;
  duration_s: number | null;
  status: MessageStatus;
  error: string | null;
  sender_name: string;
  created_at: string;
}

export interface NewMessage {
  text: string;
  color: string | null;
  duration_s: number | null;
}

export interface Comment {
  id: number;
  post_slug: string;
  color: string;
  text: string;
  created_at: string;
  expires_at: string;
}

export interface NewComment {
  text: string;
  color: string;
}

// Etch-a-sketch state mirrors the ledboard contract: pixels_b64 is the sketch
// buffer as packed bits (row-major), base64. The backend proxies /api/etch/*
// to the Pi. No login needed; the backend only accepts calls from the
// home-dash frontend (Origin/Referer check).
export interface EtchState {
  w: number;
  h: number;
  x: number;
  y: number;
  lit: number;
  pixels_b64: string;
}

export interface EtchCursor {
  x: number;
  y: number;
}

export interface EtchCleared extends EtchCursor {
  cleared: boolean;
}

// Sprites are a fixed 16x16 grid, one char per cell (row-major): "." is transparent,
// 0-f indexes SPRITE_PALETTE. Mirrors api/sprites.py.
export interface Sprite {
  name: string;
  author_name: string;
  w: number;
  h: number;
  pixels: string;
  created_at: string;
}

export interface NewSprite {
  name: string;
  pixels: string;
}

export const SPRITE_SIZE = 16;
export const SPRITE_CELLS = SPRITE_SIZE * SPRITE_SIZE;
export const SPRITE_NAME_MAX = 32;
export const SPRITE_NAME_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
export const SPRITE_TRANSPARENT = ".";
export const SPRITE_PALETTE = [
  "#000000",
  "#808080",
  "#800000",
  "#808000",
  "#008000",
  "#008080",
  "#000080",
  "#800080",
  "#ffffff",
  "#c0c0c0",
  "#ff0000",
  "#ffff00",
  "#00ff00",
  "#00ffff",
  "#0000ff",
  "#ff00ff",
] as const;

export function paletteChar(index: number): string {
  return index.toString(16);
}

export function paletteColor(cell: string): string | null {
  if (cell === SPRITE_TRANSPARENT) return null;
  const index = parseInt(cell, 16);
  return Number.isNaN(index) ? null : (SPRITE_PALETTE[index] ?? null);
}

export const MAX_MESSAGE_LENGTH = 200;
export const MAX_COMMENT_LENGTH = 200;
export const MAX_COMMENT_LINES = 5;
export const COMMENT_TTL_DAYS = 7;
export const DEFAULT_COLOR = "#FF8C00";
export const MIN_DURATION_S = 1;
export const MAX_DURATION_S = 60;
export const DEFAULT_DURATION_S = 10;
export const DURATION_PRESETS_S = [5, 10, 30, 60] as const;

export function clampDuration(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DURATION_S;
  return Math.min(MAX_DURATION_S, Math.max(MIN_DURATION_S, Math.round(value)));
}

export function formatDuration(seconds: number): string {
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type FetchLike = typeof fetch;

// FastAPI returns `detail` as a string, or a list of field errors on 422.
function extractDetail(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null || !("detail" in body)) return fallback;
  const { detail } = body as { detail: unknown };
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d) => (typeof d === "object" && d && "msg" in d ? String(d.msg) : null))
      .filter((m): m is string => m !== null);
    if (msgs.length) return msgs.join("; ");
  }
  return fallback;
}

// `token` is null for the public (anonymous) routes.
async function request<T>(
  path: string,
  token: string | null,
  init: RequestInit,
  fetchImpl: FetchLike = fetch,
): Promise<T> {
  const res = await fetchImpl(path, {
    ...init,
    headers: {
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, extractDetail(body, `Request failed (${res.status})`));
  }
  return body as T;
}

export async function listMessages(
  token: string,
  limit = 20,
  fetchImpl?: FetchLike,
): Promise<Message[]> {
  const body = await request<{ messages: Message[] }>(
    `/api/messages?limit=${limit}`,
    token,
    { method: "GET" },
    fetchImpl,
  );
  return body.messages;
}

export function sendMessage(
  token: string,
  message: NewMessage,
  fetchImpl?: FetchLike,
): Promise<Message> {
  return request<Message>(
    "/api/messages",
    token,
    { method: "POST", body: JSON.stringify(message) },
    fetchImpl,
  );
}

export async function listComments(slug: string, fetchImpl?: FetchLike): Promise<Comment[]> {
  const body = await request<{ comments: Comment[] }>(
    `/api/chatroom/${encodeURIComponent(slug)}/comments`,
    null,
    { method: "GET" },
    fetchImpl,
  );
  return body.comments;
}

export function postComment(
  slug: string,
  comment: NewComment,
  fetchImpl?: FetchLike,
): Promise<Comment> {
  return request<Comment>(
    `/api/chatroom/${encodeURIComponent(slug)}/comments`,
    null,
    { method: "POST", body: JSON.stringify(comment) },
    fetchImpl,
  );
}

export function getEtchState(fetchImpl?: FetchLike): Promise<EtchState> {
  return request<EtchState>("/api/etch", null, { method: "GET" }, fetchImpl);
}

export function etchMove(dx: number, dy: number, fetchImpl?: FetchLike): Promise<EtchCursor> {
  return request<EtchCursor>(
    "/api/etch/move",
    null,
    { method: "POST", body: JSON.stringify({ dx, dy }) },
    fetchImpl,
  );
}

export function etchClear(fetchImpl?: FetchLike): Promise<EtchCleared> {
  return request<EtchCleared>("/api/etch/clear", null, { method: "POST" }, fetchImpl);
}

export async function listSprites(limit = 200, fetchImpl?: FetchLike): Promise<Sprite[]> {
  const body = await request<{ sprites: Sprite[] }>(
    `/api/sprites?limit=${limit}`,
    null,
    { method: "GET" },
    fetchImpl,
  );
  return body.sprites;
}

export function saveSprite(
  token: string,
  sprite: NewSprite,
  fetchImpl?: FetchLike,
): Promise<Sprite> {
  return request<Sprite>(
    "/api/sprites",
    token,
    { method: "POST", body: JSON.stringify(sprite) },
    fetchImpl,
  );
}

// Older rows stored the Clerk user id as the display name; never show it.
export function displayName(name: string | null | undefined): string {
  if (!name || name.startsWith("user_")) return "someone";
  return name;
}
