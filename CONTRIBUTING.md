# Contributing

## Workflow

1. Branch from `main`.
2. Open a PR. `main` is protected: no direct pushes, no force pushes, linear history only.
3. CI (Lint, Typecheck, Test, Build), the PR-title lint and the Vercel preview must all be green.
4. Squash-merge. The **PR title becomes the commit on `main`**, so it must be a valid
   Conventional Commit (see below). The PR body becomes the commit body.

## Local checks

```bash
pnpm check        # lint + format + typecheck + test — same as CI
pnpm format       # auto-fix formatting
pnpm lint:fix     # auto-fix lint
```

Node version is pinned in `.nvmrc`; package manager is pinned in `package.json#packageManager`.

## Commit / PR title format

We follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).

```
<type>(<scope>)!: <subject>

<body>

<footer>
```

- `type` — one of `feat` `fix` `perf` `refactor` `docs` `style` `test` `build` `ci` `chore` `revert`
- `scope` — optional, kebab-case, the area touched (`auth`, `weather-widget`, `deps`)
- `subject` — imperative, lowercase first letter, no trailing full stop, header ≤ 72 chars
- `!` after the type/scope, **or** a `BREAKING CHANGE: <description>` footer, marks a breaking change

Examples:

```
feat(calendar): add week view
fix(weather): handle missing forecast payload
feat(api)!: drop legacy /v0 endpoints
chore(deps): bump next to 16.4.0
```

Git hooks (husky) run on every commit: `pre-commit` lints + formats staged files, `commit-msg`
runs commitlint. `pnpm install` installs them. Branch commits get squashed, but the PR title must
be a valid Conventional Commit.

## Versioning

We follow [Semantic Versioning 2.0.0](https://semver.org/). Versions are **never bumped by hand**.

| Change on `main`                                            | Bump (≥ 1.0.0) | Bump (0.x) |
| ----------------------------------------------------------- | -------------- | ---------- |
| `feat!` / `BREAKING CHANGE:` footer                         | major          | minor      |
| `feat`                                                      | minor          | patch      |
| `fix`, `perf`, `revert`                                     | patch          | patch      |
| `docs`, `chore`, `ci`, `refactor`, `test`, `style`, `build` | none           | none       |

While the app is `0.x`, breaking changes bump the minor and features bump the patch
(`bump-minor-pre-major` / `bump-patch-for-minor-pre-major`). Cutting `1.0.0` is a deliberate
decision: land a PR titled `feat!: release 1.0.0` (or set `"release-as": "1.0.0"` in
`release-please-config.json` for one cycle).

### How a release happens

1. Every merge to `main` runs [release-please](https://github.com/googleapis/release-please).
2. It opens (or updates) a single PR titled `chore(release): vX.Y.Z` containing the
   `package.json` bump and the generated `CHANGELOG.md` entry, computed from the commits since
   the last tag.
3. Merging that PR creates the `vX.Y.Z` tag and a GitHub Release with the changelog.
4. Vercel deploys `main` to production on every merge; the version is exposed to the app as
   `NEXT_PUBLIC_APP_VERSION`.

Tags matching `v*` are protected: they can't be deleted or moved.

### Rules of thumb

- One logical change per PR. If you can't write a single conventional title for it, split it.
- Don't mix a `feat` and a `fix` in one PR — the changelog will lie.
- Never edit `CHANGELOG.md`, `package.json#version` or `.release-please-manifest.json` manually.
- Reverts use `revert: <original subject>` and reference the original PR in the body.

## Deployments

- Every PR gets a **Vercel preview deployment**; the URL is posted on the PR.
- `main` deploys to **production** automatically.
- Roll back by redeploying a previous production deployment in Vercel, then land a `fix`/`revert` PR.
