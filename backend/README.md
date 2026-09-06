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
| `CLERK_AUTHORIZED_PARTIES`          | Comma list of origins allowed in the token's `azp`. Empty = don't check. |

Without an issuer the service still boots (`/api/healthz` works) and protected routes answer 503.

## Endpoints

| Method | Path                     | Auth | Response                                           |
| ------ | ------------------------ | ---- | -------------------------------------------------- |
| GET    | `/api/healthz`           | no   | `200 {"ok": true}`                                 |
| GET    | `/api/messages?limit=20` | yes  | `200 {"messages": [Message]}` newest first, 1..100 |
| POST   | `/api/messages`          | yes  | `202 Message`; `429` passthrough if the Pi says so |

POST body: `{"text": "1..200 chars after trim", "color": "#rrggbb" | null, "duration_s": 1..60 | null}`.
`duration_s` is how many seconds the board shows it for (scrolling text loops until it elapses);
`null` leaves it to the board's default. The whole thing is sent to `${LEDBOARD_URL}/text` with the
caller's own bearer token (5s timeout); the row is inserted with `status` `sent` or `failed`
(+ `error`) and returned either way.

```
Message = {id, text, color, duration_s, status, error, sender_name, created_at}
```

Auth: `Authorization: Bearer <clerk session token>`. RS256 via the issuer's JWKS, `exp`/`iat`/`sub`
required, 5s leeway, `azp` must be in `CLERK_AUTHORIZED_PARTIES` when set. Failures are `401`.

The `messages` table already exists in Neon; `schema.sql` is a reference copy, nothing migrates.
