#!/bin/bash
# Start the Apple Music Home Controller on this Mac.
# Usage: HOME_API_KEY=xxx ./start.sh
#
# Prerequisites:
#   - Node.js installed
#   - npx available (comes with npm)
#   - Music.app accessible (grant Accessibility permissions if prompted)

set -e
cd "$(dirname "$0")"

if [ -z "$HOME_API_KEY" ]; then
  echo "HOME_API_KEY is required. Generate one with: openssl rand -hex 32"
  exit 1
fi

# Build
npx tsc -p tsconfig.json

# Run
HOME_PORT="${HOME_PORT:-51470}" node dist/server.js
