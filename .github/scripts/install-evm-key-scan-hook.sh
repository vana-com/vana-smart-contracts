#!/usr/bin/env bash
# Explicit local bootstrap only. It never runs from package installation or CI.
set -euo pipefail

readonly CENTRAL_REPOSITORY='https://github.com/vana-com/.github.git'
readonly CENTRAL_POLICY_SHA='e16c9c1ec5001b2672d8463d3dd8f027bbcf8a35'

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

cleanup() {
  [[ -z "$tmp_dir" ]] || rm -rf "$tmp_dir"
  rmdir "$lock_dir" 2>/dev/null || true
}

mkdir -p "$cache_root"
mkdir "$lock_dir" 2>/dev/null || fail "Policy setup is already running; try again: $lock_dir"
trap cleanup EXIT

[[ ! -L "$policy_dir" ]] || fail "Refusing symlinked policy cache: $policy_dir"
if [[ -d "$policy_dir/.git" ]]; then
  origin=$(git -C "$policy_dir" remote get-url origin) || fail "Refusing unreadable policy cache: $policy_dir"
  case "$origin" in
    "$CENTRAL_REPOSITORY"|git@github.com:vana-com/.github.git) ;;
    *) fail "Refusing unexpected policy-cache origin: $policy_dir" ;;
  esac
  [[ "$(git -C "$policy_dir" rev-parse HEAD)" == "$CENTRAL_POLICY_SHA" ]] || fail "Refusing stale policy cache: $policy_dir"
  [[ -z "$(git -C "$policy_dir" status --porcelain --untracked-files=all -- ':!/.tools')" ]] || fail "Refusing modified policy cache: $policy_dir"
else
  [[ ! -e "$policy_dir" ]] || fail "Refusing invalid policy cache: $policy_dir"
  tmp_dir=$(mktemp -d "$cache_root/.policy.XXXXXX")
  git init -q "$tmp_dir"
  git -C "$tmp_dir" remote add origin "$CENTRAL_REPOSITORY"
  git -C "$tmp_dir" fetch --depth 1 origin "$CENTRAL_POLICY_SHA"
  git -C "$tmp_dir" checkout -q --detach FETCH_HEAD
  [[ "$(git -C "$tmp_dir" rev-parse HEAD)" == "$CENTRAL_POLICY_SHA" ]] || fail 'Fetched policy does not match requested SHA.'
  mv "$tmp_dir" "$policy_dir"
  tmp_dir=''
fi

rmdir "$lock_dir"
trap - EXIT
exec "$policy_dir/scripts/install-pre-push.sh" "$action" \
  --shared-dir "$policy_dir" \
  --repo "$repo_root" \
  --ref "$CENTRAL_POLICY_SHA" "$@"
