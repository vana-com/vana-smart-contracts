#!/usr/bin/env bash
# Explicit local bootstrap only. It never runs from package installation or CI.
set -euo pipefail

readonly CENTRAL_REPOSITORY='https://github.com/vana-com/.github.git'
readonly CENTRAL_POLICY_SHA='99904520ef5b18f1fceb0331b4d0b0fb182d0b62'

action=${1:-install}
case "$action" in
  install|status|uninstall) shift || true ;;
  *)
    printf 'Usage: %s [install|status|uninstall]\n' "${0##*/}" >&2
    exit 2
    ;;
esac

fail() {
  printf '%s\n' "$1" >&2
  exit 2
}

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || fail 'Run this from a Git work tree.'
[[ "$CENTRAL_POLICY_SHA" =~ ^[0-9a-f]{40}$ ]] || fail 'This bootstrap needs a reviewed 40-character central policy SHA before use.'

cache_root="${XDG_DATA_HOME:-$HOME/.local/share}/vana-secret-scan/policy"
policy_dir="$cache_root/$CENTRAL_POLICY_SHA"
lock_dir="$cache_root/.${CENTRAL_POLICY_SHA}.lock"
tmp_dir=''

# Git exports GIT_DIR (and friends) into hook processes. In a linked worktree
# that value is an ABSOLUTE path, so a plain `policy_git -C "$policy_dir" ...` still
# resolves against the pushing repository and reports ITS remote, HEAD and
# status instead of the policy cache's — validation then rejects a perfectly
# good cache with "unexpected policy-cache origin". (In a normal checkout
# GIT_DIR is the relative ".git", which happens to resolve correctly under -C,
# which is why this only bites worktrees.)
#
# The scrub list comes from git itself rather than a hardcoded set: it covers
# the directory variables, the repository-local variables (GIT_SHALLOW_FILE,
# GIT_GRAFT_FILE, GIT_REPLACE_REF_BASE, GIT_IMPLICIT_WORK_TREE) and
# GIT_CONFIG_PARAMETERS / GIT_CONFIG_COUNT (which `git -c foo=bar push`
# exports into hooks). The GIT_CONFIG_* FILE overrides are not in that list, so
# they are added explicitly — without GIT_CONFIG_GLOBAL a caller can point
# `remote.origin.url` at vana-com/.github from its own environment and satisfy
# the origin check against a cache whose real origin is something else.
# A hardcoded fallback covers a git too old to answer.
policy_git() {
  local scrub=()
  local v
  while IFS= read -r v; do
    [[ -n "$v" ]] && scrub+=(-u "$v")
  done < <(git rev-parse --local-env-vars 2>/dev/null || printf '%s\n' \
    GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY \
    GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR \
    GIT_CONFIG GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT)
  for v in GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM GIT_CONFIG_NOSYSTEM; do
    scrub+=(-u "$v")
  done
  env "${scrub[@]}" git "$@"
}

cleanup() {
  [[ -z "$tmp_dir" ]] || rm -rf "$tmp_dir"
  rmdir "$lock_dir" 2>/dev/null || true
}

mkdir -p "$cache_root"
mkdir "$lock_dir" 2>/dev/null || fail "Policy setup is already running; try again: $lock_dir"
trap cleanup EXIT

[[ ! -L "$policy_dir" ]] || fail "Refusing symlinked policy cache: $policy_dir"
if [[ -d "$policy_dir/.git" ]]; then
  origin=$(policy_git -C "$policy_dir" remote get-url origin) || fail "Refusing unreadable policy cache: $policy_dir"
  case "$origin" in
    "$CENTRAL_REPOSITORY"|https://github.com/vana-com/.github|git@github.com:vana-com/.github|git@github.com:vana-com/.github.git) ;;
    *) fail "Refusing unexpected policy-cache origin: $policy_dir" ;;
  esac
  [[ "$(policy_git -C "$policy_dir" rev-parse HEAD)" == "$CENTRAL_POLICY_SHA" ]] || fail "Refusing stale policy cache: $policy_dir"
  [[ -z "$(policy_git -C "$policy_dir" status --porcelain --untracked-files=all -- ':!/.tools')" ]] || fail "Refusing modified policy cache: $policy_dir"
else
  [[ ! -e "$policy_dir" ]] || fail "Refusing invalid policy cache: $policy_dir"
  tmp_dir=$(mktemp -d "$cache_root/.policy.XXXXXX")
  policy_git init -q "$tmp_dir"
  policy_git -C "$tmp_dir" remote add origin "$CENTRAL_REPOSITORY"
  policy_git -C "$tmp_dir" fetch --depth 1 origin "$CENTRAL_POLICY_SHA"
  policy_git -C "$tmp_dir" checkout -q --detach FETCH_HEAD
  [[ "$(policy_git -C "$tmp_dir" rev-parse HEAD)" == "$CENTRAL_POLICY_SHA" ]] || fail 'Fetched policy does not match requested SHA.'
  mv "$tmp_dir" "$policy_dir"
  tmp_dir=''
fi

if [[ "$action" == install ]]; then
  "$policy_dir/scripts/install-pre-push.sh" prepare \
    --shared-dir "$policy_dir" \
    --repo "$repo_root" \
    --ref "$CENTRAL_POLICY_SHA"
fi

rmdir "$lock_dir"
trap - EXIT
exec "$policy_dir/scripts/install-pre-push.sh" "$action" \
  --shared-dir "$policy_dir" \
  --repo "$repo_root" \
  --ref "$CENTRAL_POLICY_SHA" "$@"
