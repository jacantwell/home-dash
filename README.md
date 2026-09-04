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
