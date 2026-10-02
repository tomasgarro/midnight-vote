#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mode="${1:-demo}"
if [[ "$mode" != "demo" && "$mode" != "undeployed" && "$mode" != "preview" ]]; then
  printf 'Usage: bash scripts/verify-linux.sh [demo|undeployed|preview]\n' >&2
  exit 2
fi

fail() {
  printf 'Linux verification error: %s\n' "$1" >&2
  exit 1
}

[[ "$(uname -s)" == "Linux" ]] || fail "run this script inside Linux or WSL, not PowerShell."
node_bin="$(command -v node || true)"
npm_bin="$(command -v npm || true)"
[[ -n "$npm_bin" ]] || fail "Linux npm is required. Load nvm inside WSL."
case "$node_bin:$npm_bin" in
  *:/mnt/*) fail "Windows npm leaked into WSL PATH. Use Linux Node/npm installed by nvm." ;;
esac
[[ -n "$node_bin" ]] || fail "Linux Node.js is required. Load nvm inside WSL."
case "$node_bin" in
  /mnt/*) fail "Windows Node leaked into WSL PATH. Use Linux Node installed by nvm." ;;
esac

node_major="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$node_major" =~ ^[0-9]+$ && "$node_major" -ge 22 ]] || fail "Node.js 22 or newer is required; found $(node --version)."

compiler_available=false
if [[ -n "${COMPACTC_BIN:-}" || -n "${COMPACT_BIN:-}" ]]; then
  compiler_available=true
elif command -v compactc >/dev/null 2>&1 && compactc --version >/dev/null 2>&1; then
  compiler_available=true
elif command -v compact >/dev/null 2>&1 && compact compile --version >/dev/null 2>&1; then
  compiler_available=true
fi
if [[ "$compiler_available" != true ]]; then
  fail "A working Compact compiler is required because generated contract assets are not tracked. Verify compactc --version or compact compile --version."
fi

# CI starts from a fresh checkout, which has none of the untracked generated
# bindings. Start without them here too, so that a step which needs them before
# anything has generated them fails on this machine as it would there.
rm -rf api/src/generated/credential-registry-v1 api/src/generated/referendum-v2

npm run validate:contract
npm run build --workspace midnight-referendum-api
npm test

if [[ "$mode" == "undeployed" || "$mode" == "preview" ]]; then
  npm run build
fi

printf 'Linux %s verification passed.\n' "$mode"
