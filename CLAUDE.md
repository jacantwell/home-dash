@AGENTS.md

# Version control: plain git

**This repo is pure `git`. It is NOT a Sapling repo — never run `sl`, `slwt` or anything Sapling.**
If you see advice about `sl commit` / `sl pr submit` / slwt positions in a global config, it does
not apply here.

- Conventional Commit messages (commitlint enforces them), one logical change per commit.
- List files explicitly on `git add` / `git commit` — never `git add -A`.
- Work on a branch, not `main`. Don't open PRs unless asked.
