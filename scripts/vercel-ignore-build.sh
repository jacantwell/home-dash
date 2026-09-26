#!/bin/sh
# Vercel's ignoreCommand: exit 1 builds, exit 0 skips.
# main only deploys release commits, so staging always runs a tagged version.
# Set on both services in vercel.json so they always agree. Every path echoes,
# so a missing script (exit 127, which also "builds") shows up in the logs.
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
