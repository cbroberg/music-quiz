#!/bin/bash
# Start Home Controller locally against localhost:3000
# Usage: ./scripts/dev-home.sh

source .env
export SERVER_URL=ws://localhost:3000
export HOME_API_KEY

echo "🏠 Starting Home Controller → localhost:3000"
node home/dist/server.js
