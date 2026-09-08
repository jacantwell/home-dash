# home-dash-api

FastAPI service behind `/api/*`. Verifies Clerk session JWTs, stores messages in Neon and
forwards them to the ledboard on the Pi. Deployed by Vercel Services (`vercel.json`: root
`backend/`, framework `fastapi`, entrypoint `main:app`), so routes carry the full `/api/...` path.

## Run locally

```bash
cd backend
uv sync            # python 3.12 from .python-version, deps from uv.lock
make dev           # uvicorn on http://localhost:8000 with reload
make test          # pytest (no network, no DB)
make lint          # ruff check + format check
make fmt           # ruff format + autofix
```

`next dev` on :3000 rewrites `/api/:path*` to :8000, so the frontend talks to this straight away.

## Env vars

Read from the process env, then `../.env.local` (the repo's), then `backend/.env` (later wins).

| Var                                 | Purpose                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `DATABASE_URL`                      | Neon connection string (pooled). One connection per request.             |
| `LEDBOARD_URL`                      | Base URL of the Pi daemon, default `http://localhost:8080`.              |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk issuer is derived from it (`pk_test_<b64(frontend-api-host$)>`).   |
| `CLERK_ISSUER`                      | Optional override of the derived issuer.                                 |
| `CLERK_AUTHORIZED_PARTIES`          | Comma list of origins allowed in the token's `azp` and in etch `Origin`/`Referer`. Empty = don't check. |

Without an issuer the service still boots (`/api/healthz` works) and protected routes answer 503.

## Endpoints

| Method | Path                                      | Auth | Response                                           |
| ------ | ----------------------------------------- | ---- | -------------------------------------------------- |
| GET    | `/api/healthz`                            | no   | `200 {"ok": true}`                                 |
| GET    | `/api/messages?limit=20`                  | yes  | `200 {"messages": [Message]}` newest first, 1..100 |
| POST   | `/api/messages`                           | yes  | `202 Message`; `429` passthrough if the Pi says so |
| GET    | `/api/chatroom/{slug}/comments?limit=100` | no   | `200 {"comments": [Comment]}` oldest first, 1..200 |
| POST   | `/api/chatroom/{slug}/comments`           | no   | `201 Comment`                                      |
| GET    | `/api/etch`                               | frontend | `200` sketch state, proxied from the Pi         |
| POST   | `/api/etch/move`                          | frontend | `200 {"x","y"}`; nudges the stylus             |
| POST   | `/api/etch/clear`                         | frontend | `200 {"cleared","x","y"}`; shakes the screen clean |

POST body: `{"text": "1..200 chars after trim", "color": "#rrggbb" | null, "duration_s": 1..60 | null}`.
`duration_s` is how many seconds the board shows it for (scrolling text loops until it elapses);
`null` leaves it to the board's default. The whole thing is sent to `${LEDBOARD_URL}/text` with the
caller's own bearer token (5s timeout); the row is inserted with `status` `sent` or `failed`
(+ `error`) and returned either way.

```
Message = {id, text, color, duration_s, status, error, sender_name, created_at}
```

### Etch-a-sketch

`GET /api/etch` returns the Pi's sketch buffer
(`{w, h, x, y, lit, pixels_b64}`, packed-bits bitmap, base64). `POST /api/etch/move`
takes `{"dx": -32..32, "dy": -32..32}` (not both zero) and returns the new cursor;
`POST /api/etch/clear` wipes the screen. All three are anonymous (no login) but
frontend-only: the request's `Origin`/`Referer` must match an entry in
`CLERK_AUTHORIZED_PARTIES`, otherwise it's a `403`. Add preview deployment origins
there when you need etch on a preview; empty means don't check (local dev).
The backend forwards the browser's `Origin`/`Referer` to `${LEDBOARD_URL}/etch/*`
(5s timeout) so the Pi can apply the same check: an unreachable Pi is a `502`,
a Pi error (e.g. `503` when its etch app is off) passes through with its status code.

Auth: `Authorization: Bearer <clerk session token>`. RS256 via the issuer's JWKS, `exp`/`iat`/`sub`
required, 5s leeway, `azp` must be in `CLERK_AUTHORIZED_PARTIES` when set. Failures are `401`.

### Chat room comments

Anonymous, no auth. `slug` matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`, max 64. POST body:
`{"text": "1..200 chars, up to 5 lines", "color": "#rrggbb"}`. Nothing identifying is stored.
Comments older than 7 days are hidden from GET and deleted on the next POST.

```
Comment = {id, post_slug, color, text, created_at, expires_at}
```

The `messages` and `blog_comments` tables already exist in Neon; `schema.sql` is a reference copy,
nothing migrates. `blog_comments` keeps its name because renaming it would need a migration the
service does not run.
