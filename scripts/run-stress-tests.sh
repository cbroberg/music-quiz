#!/bin/bash
# Stress test runner — 50Q then 100Q headless
# Run while Christian is away

set -e
cd /Users/cb/Apps/cbroberg/apple-music-mcp

echo "=== Waiting for current test to finish ==="
while pgrep -f "e2e-screenshot-test-3players-headless" > /dev/null 2>&1; do
  sleep 10
done
echo "=== Previous test done ==="

echo ""
echo "=== Rebuilding with scaled pool ==="
pnpm build

echo ""
echo "=== Restarting server (MUTE_ALL=true) ==="
lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null || true
pkill -f "home/dist/server.js" 2>/dev/null || true
sleep 2
NODE_ENV=development node packages/mcp-server/server.js > /tmp/quiz-server-50q.log 2>&1 &
sleep 5
source .env && MCP_WS_URL=ws://localhost:3000/home-ws HOME_API_KEY=$HOME_API_KEY node home/dist/server.js > /tmp/quiz-hc-50q.log 2>&1 &
sleep 3
echo "Server ready"

echo ""
echo "========================================="
echo "=== RUNNING 50Q HEADLESS TEST =========="
echo "========================================="
node scripts/e2e-screenshot-test-3players-headless.js 50 2>&1 | tee /tmp/e2e-50q.log

echo ""
echo "=== Restarting server for 100Q ==="
lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null || true
pkill -f "home/dist/server.js" 2>/dev/null || true
sleep 2
NODE_ENV=development node packages/mcp-server/server.js > /tmp/quiz-server-100q.log 2>&1 &
sleep 5
source .env && MCP_WS_URL=ws://localhost:3000/home-ws HOME_API_KEY=$HOME_API_KEY node home/dist/server.js > /tmp/quiz-hc-100q.log 2>&1 &
sleep 3

echo ""
echo "========================================="
echo "=== RUNNING 100Q HEADLESS TEST ========="
echo "========================================="
node scripts/e2e-screenshot-test-3players-headless.js 100 2>&1 | tee /tmp/e2e-100q-final.log

echo ""
echo "========================================="
echo "=== ALL TESTS COMPLETE ================="
echo "========================================="

# Bank stats
echo ""
echo "=== Question Bank Stats ==="
cat /tmp/quiz-question-bank.json | python3 -c "
import json,sys
bank = json.load(sys.stdin)
print(f'Total: {len(bank)} questions')
types = {}
for q in bank:
    t = q['questionType']
    types[t] = types.get(t, 0) + 1
for t, c in sorted(types.items(), key=lambda x: -x[1]):
    print(f'  {t}: {c}')
"

echo ""
echo "Done! Check recordings/ for screenshots and /tmp/e2e-*.log for details."
