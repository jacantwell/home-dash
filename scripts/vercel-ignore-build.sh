#!/bin/sh
# Vercel's Ignored Build Step: exit 1 builds, exit 0 skips.
# main only deploys release commits, so staging always runs a tagged version.
# Wired up in Project Settings > Build and Deployment, not vercel.json: with
# `services`, vercel.json only takes ignoreCommand per service, and Vercel
# doesn't run those for git deploys.
if [ "${VERCEL_GIT_COMMIT_REF:-}" != main ]; then
  echo "ref ${VERCEL_GIT_COMMIT_REF:-<none>} is not main, building"
  exit 1
fi
subject="${VERCEL_GIT_COMMIT_MESSAGE:-$(git log -1 --format=%s)}"
case "$subject" in
  "chore(release): "*) echo "release commit, building"; exit 1 ;;
esac
echo "not a release commit, skipping; staging updates when the release PR merges"
exit 0
