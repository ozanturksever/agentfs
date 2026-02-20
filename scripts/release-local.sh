#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOTP_SCRIPT="/Users/ozant/nix-ozan/scripts/get-totp.sh"
TOTP_ID="ff78c8cc-ab04-4bf6-9ac1-8491768d1d65"

# --- Argument: version (e.g. 0.8.0) ---
VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>  (e.g. 0.8.0, without 'v' prefix)" >&2
  exit 1
fi
TAG="v${VERSION}"

# Determine npm dist-tag
if [[ "$TAG" == *-* ]]; then
  NPM_TAG="next"
  GH_PRERELEASE="--prerelease"
else
  NPM_TAG="latest"
  GH_PRERELEASE=""
fi

echo "==> Releasing $TAG (npm tag: $NPM_TAG)"

# --- 1. Bump SDK version, commit, push ---
echo "==> Bumping sdk/typescript version to $VERSION"
cd "$REPO_ROOT/sdk/typescript"
sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" package.json

cd "$REPO_ROOT"
if ! git diff --quiet sdk/typescript/package.json; then
  git add sdk/typescript/package.json
  git commit -m "chore: bump sdk version to $VERSION"
fi

echo "==> Pushing main"
git push origin main

# --- 2. Tag and push ---
if ! git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "==> Creating tag $TAG"
  git tag "$TAG"
fi
git push origin "$TAG"

# --- 3. Build CLI locally (macOS aarch64) ---
echo "==> Building CLI (aarch64-apple-darwin)"
cd "$REPO_ROOT/cli"
cargo build --profile dist

ARTIFACT_NAME="agentfs-aarch64-apple-darwin.tar.gz"
STAGING=$(mktemp -d)
cp "$REPO_ROOT/cli/target/dist/agentfs" "$STAGING/"
tar czf "$REPO_ROOT/$ARTIFACT_NAME" -C "$STAGING" agentfs
rm -rf "$STAGING"

# --- 4. Create GitHub release with binary ---
echo "==> Creating GitHub release $TAG"
cd "$REPO_ROOT"
if gh release view "$TAG" -R ozanturksever/agentfs >/dev/null 2>&1; then
  echo "==> Release $TAG exists, uploading asset"
  gh release upload "$TAG" "$ARTIFACT_NAME" --clobber -R ozanturksever/agentfs
else
  gh release create "$TAG" \
    --title "$TAG" \
    --generate-notes \
    $GH_PRERELEASE \
    "$ARTIFACT_NAME" \
    -R ozanturksever/agentfs
fi
rm -f "$ARTIFACT_NAME"

# --- 5. Build and publish npm package ---
echo "==> Building TypeScript SDK"
cd "$REPO_ROOT/sdk/typescript"
npm install
npm run build

echo "==> Publishing @fatagnus/agentfs-sdk@$VERSION to npm (tag: $NPM_TAG)"
OTP="$("$TOTP_SCRIPT" "$TOTP_ID")"
npm publish --access public --tag "$NPM_TAG" --otp="$OTP"

# --- Done ---
echo ""
echo "==> Done"
echo "  GitHub: https://github.com/ozanturksever/agentfs/releases/tag/$TAG"
echo "  npm:    https://www.npmjs.com/package/@fatagnus/agentfs-sdk"
