# home-dash

Home dashboard. Next.js 16 (App Router) + React 19 + Tailwind 4, TypeScript, deployed on Vercel.

[![CI](https://github.com/jacantwell/home-dash/actions/workflows/ci.yml/badge.svg)](https://github.com/jacantwell/home-dash/actions/workflows/ci.yml)
[![Release](https://github.com/jacantwell/home-dash/actions/workflows/release-please.yml/badge.svg)](https://github.com/jacantwell/home-dash/actions/workflows/release-please.yml)

## Getting started

Three processes make up the local stack:

```bash
cd web
nvm use                      # node version from web/.nvmrc
pnpm install                 # also installs the git hooks
cp ../.env.example ../.env.local && ln -s ../.env.local .env.local   # one env file at the repo root, see below
pnpm dev                     # Next.js on http://localhost:3000

cd backend && make dev       # FastAPI on http://localhost:8000 (see backend/README.md)

# ledboard simulator on http://localhost:8080 (separate repo); point LEDBOARD_URL at it
```

In development `next.config.ts` rewrites `/api/*` to the FastAPI server on `:8000`. In production
`vercel.json` routes `/api/*` to the Python service before Next sees it, so there is no prod rewrite.

### Environment

`.env.example` lists every variable. Copy it to `.env.local` (git-ignored) and fill it in:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`: from the Clerk dashboard, or run
  `clerk env pull` with the Clerk CLI to write them for you.
- `DATABASE_URL`, `LEDBOARD_URL`, `CLERK_AUTHORIZED_PARTIES`: only the backend reads these.

## Auth

Clerk handles sign-in. `web/src/proxy.ts` (Next 16's middleware) runs `clerkMiddleware()` on every
request so `auth()` works in server components; it does not protect paths itself. `/board`
checks `auth()` and shows a sign-in prompt when logged out. The client fetches `/api/*` with
the Clerk session token as `Authorization: Bearer <token>`, and the backend verifies it and
forwards the same token to the ledboard. `/etch` is the exception: no sign-in needed, but the
backend only accepts calls from the home-dash frontend (request `Origin`/`Referer` must be in
`CLERK_AUTHORIZED_PARTIES`).

## Scripts

| Script            | What                                          |
| ----------------- | --------------------------------------------- |
| `pnpm dev`        | Dev server (Turbopack)                        |
| `pnpm build`      | Production build                              |
| `pnpm check`      | Lint + format + typecheck + test (same as CI) |
| `pnpm test:watch` | Vitest in watch mode                          |
| `pnpm format`     | Prettier write                                |

## Backend

`backend/` is a small FastAPI service (Python 3.12, [uv](https://docs.astral.sh/uv/)) that Vercel
Services deploys next to the Next app and serves at `/api/*` (see `vercel.json`). It verifies Clerk
session tokens, stores messages in Neon and forwards them to the ledboard on the Pi.

```bash
cd backend
uv sync
make dev           # http://localhost:8000, next dev proxies /api/* here
make test && make lint
```

Env vars, endpoints and the auth contract are in [backend/README.md](./backend/README.md).

## Contributing, commits & versioning

See [CONTRIBUTING.md](./CONTRIBUTING.md). TL;DR: Conventional Commit PR titles, squash-merge,
release-please cuts SemVer releases automatically.

## Deployment

Vercel via the GitHub integration: PRs get preview deployments, `main` goes to production.

## Duku

Every production deploy is explored by [Duku](https://duku.ai):

- `duku-environment.yml` waits for the Vercel **Production** deployment of each `main` commit,
  then runs the `environment` action against the `default` environment — Duku's name for a
  product's production environment — labelling the build with the app version (`vX.Y.Z`, same
  as `NEXT_PUBLIC_APP_VERSION`) and linking the PR preview builds that landed in it.

PR previews are deliberately **not** explored: exploration runs at the environment level only,
so a PR's signal comes from CI and the build it lands as.

Configuration lives in repo settings: variables `DUKU_PRODUCT_ID`, `DUKU_API_URL` (production
platform) and secret `PLATFORM_API_KEY`. The action is pinned to an unreleased commit of
`duku-ai/actions`; see the comment in the workflow.
