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

Vercel, via the GitHub integration. Three environments, and nothing reaches production
without someone pressing a button:

| Environment | URL                                            | Deployed from       |
| ----------- | ---------------------------------------------- | ------------------- |
| Preview     | `home-dash-git-<branch>-…vercel.app`           | every PR branch     |
| Staging     | [staging.worm.beer](https://staging.worm.beer) | every `main` commit |
| Production  | [worm.beer](https://worm.beer)                 | `production` branch |

Staging is a Vercel _preview_ deployment with `staging.worm.beer` pinned to the `main` branch,
so it shares the Preview environment variables with PR previews (Hobby has no custom
environments). Production is the only thing reading the Production scope. Every backing service
except the Pi is split along that line:

| Service                    | Preview scope (staging + PR previews) | Production scope (worm.beer)        |
| -------------------------- | ------------------------------------- | ----------------------------------- |
| Clerk                      | `home-dash` **development** instance  | `home-dash` **production** instance |
| Neon                       | `home-dash` project, `staging` branch | `home-dash` project, `main` branch  |
| Pi                         | same `LEDBOARD_URL`                   | same `LEDBOARD_URL`                 |
| `CLERK_AUTHORIZED_PARTIES` | `https://staging.worm.beer`           | `https://worm.beer`                 |

The Neon `staging` branch is a copy-on-write fork of `main`; reset it from the parent in the Neon
console whenever staging needs prod-shaped data again. Because the Pi is shared and verifies the
forwarded Clerk token itself, the ledboard daemon has to trust **both** Clerk issuers.

Vercel Authentication (Deployment Protection) is off: on Hobby it cannot exempt a preview branch
domain, and with it on `staging.worm.beer` redirects everyone to Vercel SSO. Clerk still gates
`/board`.

### Promoting staging to production

Production tracks the `production` branch, which never moves on its own. Run the
**Promote to production** workflow from the Actions tab (`workflow_dispatch`) to fast-forward it.
Leave `ref` empty and it promotes the **latest release tag** — the version that release-please
just cut and that is already sitting on staging:

```
PR ──merge──► main ──auto──► staging.worm.beer ──► release PR opens itself
                                                        │
                        merge release PR ──► vX.Y.Z tag ─┴─► Duku `staging` publish + runs
                                                        │
 Actions ▸ Promote to production ─(approval)─► git push --ff production ──► worm.beer
                                                        └─► Duku `production` publish + runs
```

It refuses to promote a commit that has not landed on `main`, one that is not a tagged release
(`allow-unreleased` overrides — Duku would then label the build with the last released version),
one whose CI did not pass (`skip-ci-check` overrides), or anything that is not a fast-forward of
the current `production`. The approval gate is the `promote` GitHub Environment — _not_
`Production`, which belongs to Vercel's integration and would stall its deployment statuses if it
carried a protection rule.

Rolling back is the same button with an older release tag as `ref` and `allow-rollback` ticked —
that is the only thing allowed to move `production` backwards, and it force-pushes with a lease.
For the 30-second case use **Instant Rollback** in the Vercel dashboard instead, then promote a
real release afterwards so the branch and the live alias agree again.

## Duku

Every **release** is published to [Duku](https://duku.ai) twice — once per environment — and
explored and tested there. `duku-environment.yml` is a reusable workflow that waits for the
Vercel deployment of a commit, records it as a Duku build labelled with the release (`vX.Y.Z`,
same as `NEXT_PUBLIC_APP_VERSION`) and kicks off the environment's exploration + test cases:

| Trigger                                       | Vercel deployment           | Duku environment |
| --------------------------------------------- | --------------------------- | ---------------- |
| Merging the release PR (`release-please.yml`) | Preview of `main` (staging) | `staging`        |
| **Promote to production**                     | Production                  | `production`     |

Both names must match the environments declared on the product in Viewport (Product settings →
Environments); the action does not create them.

Ordinary merges to `main` reach staging via Vercel but are **not** published to Duku — only tagged
versions are, so every Duku build maps to a GitHub Release. PR previews are deliberately not
explored either: exploration runs at the environment level only, so a PR's signal comes from CI
and the release it lands in.

Neither publish fires off a `push:` event. The staging one chains onto the release-please job
that created the tag, and the production one is the second job of the promote run, because
pushes made with the `GITHUB_TOKEN` never start workflows. To repeat a publish by hand, dispatch
**Duku environment** with the environment and commit.

Configuration lives in repo settings: variables `DUKU_PRODUCT_ID`, `DUKU_API_URL` (production
platform) and secret `PLATFORM_API_KEY`. The action is pinned to an unreleased commit of
`duku-ai/actions`; see the comment in the workflow.
