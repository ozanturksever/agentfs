#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOTP_SCRIPT="/Users/ozant/nix-ozan/scripts/get-totp.sh"
TOTP_ID="ff78c8cc-ab04-4bf6-9ac1-8491768d1d65"

# Determine tag from argument or git
TAG="${1:-}"
if [ -z "$TAG" ]; then
  TAG="$(git describe --tags --exact-match 2>/dev/null || true)"
  if [ -z "$TAG" ]; then
    echo "Usage: $0 <tag>  (e.g. v0.7.0)" >&2
    exit 1
  fi
fi

# Determine npm dist-tag
if [[ "$TAG" == *-* ]]; then
  NPM_TAG="next"
else
  NPM_TAG="latest"
fi

echo "==> Releasing $TAG (npm tag: $NPM_TAG)"

# 1. Tag and push (if tag doesn't exist yet)
if ! git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "==> Creating tag $TAG"
  git tag "$TAG"
  git push origin "$TAG"
else
  echo "==> Tag $TAG already exists"
fi

# 2. Trigger GitHub Actions build
echo "==> Triggering GitHub Actions release workflow"
gh workflow run release.yml -f "tag=$TAG" -R ozanturksever/agentfs

# 3. Build and publish npm package
echo "==> Building TypeScript SDK"
cd "$REPO_ROOT/sdk/typescript"
npm install
npm run build

echo "==> Publishing @fatagnus/agentfs-sdk to npm (tag: $NPM_TAG)"
OTP="$("$TOTP_SCRIPT" "$TOTP_ID")"
npm publish --access public --tag "$NPM_TAG" --otp="$OTP"

echo "==> Done"
echo "  GitHub Release: check https://github.com/ozanturksever/agentfs/actions"
echo "  npm: https://www.npmjs.com/package/@fatagnus/agentfs-sdk"
