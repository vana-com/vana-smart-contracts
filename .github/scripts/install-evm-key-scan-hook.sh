#!/usr/bin/env bash
# Explicit local bootstrap only. It never runs from package installation or CI.
#
# This stub is deliberately thin: it names the reviewed policy commit and hands
# off to that commit's own bootstrap. All validation, locking and installation
# logic lives in vana-com/.github so a fix there does not need editing here —
# this file changes only when the pin is deliberately advanced.
set -euo pipefail

readonly CENTRAL_REPOSITORY='https://github.com/vana-com/.github.git'
readonly CENTRAL_POLICY_SHA='7f59130a9d2f3954c15181068e8d8195dbc45c90'

[[ "$CENTRAL_POLICY_SHA" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'This bootstrap needs a reviewed 40-character central policy SHA before use.\n' >&2
  exit 2
}

cache_root="${XDG_DATA_HOME:-$HOME/.local/share}/vana-secret-scan/policy"
policy_dir="$cache_root/$CENTRAL_POLICY_SHA"

# Fetch the pinned policy if it is not already cached. Fetching by SHA is
# self-authenticating: git verifies that the delivered objects hash to the
# requested commit, so a wrong or tampered response cannot satisfy this check.
# The central bootstrap re-validates origin, SHA and cleanliness before use.
if [[ ! -d "$policy_dir/.git" ]]; then
  [[ ! -e "$policy_dir" ]] || {
    printf 'Refusing invalid policy cache: %s\n' "$policy_dir" >&2
    exit 2
  }
  mkdir -p "$cache_root"
  tmp_dir=$(mktemp -d "$cache_root/.policy.XXXXXX")
  trap 'rm -rf "$tmp_dir"' EXIT
  # Scrub the inherited repository environment: git exports an absolute GIT_DIR
  # into hook processes, which would otherwise redirect these commands at the
  # pushing repository instead of the new checkout.
  scrub=()
  while IFS= read -r v; do
    [[ -n "$v" ]] && scrub+=(-u "$v")
  done < <(git rev-parse --local-env-vars 2>/dev/null || printf '%s\n' \
    GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY \
    GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR \
    GIT_CONFIG GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT)
  for v in GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM GIT_CONFIG_NOSYSTEM; do
    scrub+=(-u "$v")
  done
  env "${scrub[@]}" git init -q "$tmp_dir"
  env "${scrub[@]}" git -C "$tmp_dir" remote add origin "$CENTRAL_REPOSITORY"
  env "${scrub[@]}" git -C "$tmp_dir" fetch --depth 1 origin "$CENTRAL_POLICY_SHA"
  env "${scrub[@]}" git -C "$tmp_dir" checkout -q --detach FETCH_HEAD
  [[ "$(env "${scrub[@]}" git -C "$tmp_dir" rev-parse HEAD)" == "$CENTRAL_POLICY_SHA" ]] || {
    printf 'Fetched policy does not match requested SHA.\n' >&2
    exit 2
  }
  mv "$tmp_dir" "$policy_dir"
  trap - EXIT
fi

exec env VANA_POLICY_SHA="$CENTRAL_POLICY_SHA" "$policy_dir/scripts/bootstrap.sh" "$@"
