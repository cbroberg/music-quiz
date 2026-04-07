#!/bin/bash
# Start the Apple Music Home Controller agent.
# It connects OUTBOUND to the MCP server via WebSocket.
#
# Usage:
#   HOME_API_KEY=xxx ./start.sh
#   HOME_API_KEY=xxx MCP_WS_URL=wss://music.quiz-mash.com/home-ws ./start.sh

set -e
cd "$(dirname "$0")"

if [ -z "$HOME_API_KEY" ]; then
  echo "HOME_API_KEY is required. Generate one with: openssl rand -hex 32"
  exit 1
fi

MCP_WS_URL="${MCP_WS_URL:-wss://music.quiz-mash.com/home-ws}"
export MCP_WS_URL HOME_API_KEY

# Build
npx tsc -p tsconfig.json

# Run
node dist/server.js
