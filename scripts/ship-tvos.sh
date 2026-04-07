#!/usr/bin/env bash
# Ship Music Quiz tvOS to TestFlight.
#
# Usage:
#   scripts/ship-tvos.sh           # default: beta lane (upload to TestFlight)
#   scripts/ship-tvos.sh build     # build only, no upload
#   scripts/ship-tvos.sh release_beta
set -euo pipefail

LANE="${1:-beta}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TVOS_DIR="$ROOT/apps/tvos"

if [[ ! -d "$TVOS_DIR" ]]; then
  echo "❌ apps/tvos not found at $TVOS_DIR" >&2
  exit 1
fi

cd "$TVOS_DIR"

# Regenerate the Xcode project so any new Swift files are picked up.
ruby scripts/generate_xcodeproj.rb

if [[ ! -f "fastlane/.env" ]]; then
  echo "⚠️  fastlane/.env not found — copy fastlane/.env.example and fill in credentials" >&2
fi

if command -v bundle >/dev/null 2>&1 && [[ -f "Gemfile.lock" ]]; then
  bundle exec fastlane "$LANE"
else
  fastlane "$LANE"
fi
