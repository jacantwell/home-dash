#!/bin/sh
# Vercel's ignoreCommand: exit 1 builds, exit 0 skips.
# main only deploys release commits, so staging always runs a tagged version.
[ "${VERCEL_GIT_COMMIT_REF:-}" = main ] || exit 1
subject="${VERCEL_GIT_COMMIT_MESSAGE:-$(git log -1 --format=%s)}"
case "$subject" in
  "chore(release): "*) echo "release commit, building"; exit 1 ;;
esac
echo "not a release commit, skipping; staging updates when the release PR merges"
exit 0
