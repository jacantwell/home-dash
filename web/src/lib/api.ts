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
    `/api/blog/${encodeURIComponent(slug)}/comments`,
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
    `/api/blog/${encodeURIComponent(slug)}/comments`,
    null,
    { method: "POST", body: JSON.stringify(comment) },
    fetchImpl,
  );
}
