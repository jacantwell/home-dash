# home-dash

Home dashboard. Next.js 16 (App Router) + React 19 + Tailwind 4, TypeScript, deployed on Vercel.

[![CI](https://github.com/jacantwell/home-dash/actions/workflows/ci.yml/badge.svg)](https://github.com/jacantwell/home-dash/actions/workflows/ci.yml)
[![Release](https://github.com/jacantwell/home-dash/actions/workflows/release-please.yml/badge.svg)](https://github.com/jacantwell/home-dash/actions/workflows/release-please.yml)

## Getting started

```bash
nvm use            # node version from .nvmrc
pnpm install
pnpm dev           # http://localhost:3000
```

## Scripts

| Script            | What                                          |
| ----------------- | --------------------------------------------- |
| `pnpm dev`        | Dev server (Turbopack)                        |
| `pnpm build`      | Production build                              |
| `pnpm check`      | Lint + format + typecheck + test (same as CI) |
| `pnpm test:watch` | Vitest in watch mode                          |
| `pnpm format`     | Prettier write                                |

## Contributing, commits & versioning

See [CONTRIBUTING.md](./CONTRIBUTING.md). TL;DR: Conventional Commit PR titles, squash-merge,
release-please cuts SemVer releases automatically.

## Deployment

Vercel via the GitHub integration: PRs get preview deployments, `main` goes to production.

## Duku

Every PR's Vercel preview and every production deploy is explored by [Duku](https://duku.ai):

- `duku-preview.yml` waits for the Vercel **Preview** deployment of the PR head, then runs the
  `preview` action. Results land as a sticky PR comment and a `Duku Exploration (<product>)`
  check run.
- `duku-environment.yml` waits for the Vercel **Production** deployment of each `main` commit,
  then runs the `environment` action against the `default` environment — Duku's name for a
  product's production environment — labelling the build with the app version (`vX.Y.Z`, same
  as `NEXT_PUBLIC_APP_VERSION`) and linking the PR preview builds that landed in it.

Configuration lives in repo settings: variables `DUKU_PRODUCT_ID`, `DUKU_API_URL` (sandbox for
now) and secrets `PLATFORM_API_KEY`, optional `VERCEL_AUTOMATION_BYPASS_SECRET`. Both actions
are pinned to an unreleased commit of `duku-ai/actions`; see the comments in the workflows.
