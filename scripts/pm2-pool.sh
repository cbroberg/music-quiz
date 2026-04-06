#!/bin/bash
# PM2 dev pool for music-quiz.
#
# Usage:
#   ./scripts/pm2-pool.sh up               Start the pool (kills standalone dev servers on pool ports first)
#   ./scripts/pm2-pool.sh down             Stop and remove pool processes
#   ./scripts/pm2-pool.sh status           Show pm2 status
#   ./scripts/pm2-pool.sh logs [name]      Tail logs (all, or one app)
#   ./scripts/pm2-pool.sh restart [name]   Restart all or one app

set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

# Pool ports we manage. Anything listening here gets killed during `up`
# unless it's a protected process (see below).
POOL_PORTS=(3000)

# Protected ports — processes owning ANY of these will NEVER be killed,
# even if they also hold a pool port. These are ports owned by other
# things on Christian's machine that this script must never touch.
PROTECTED_PORTS=(
  3002 3009 3010 3018 3019 3020 3021 3022 3023 3024 3025
  3030 3036 3051 4444 5000 6463 7000 7679 8888
  15292 15393 16494 52698 54237 55261 59768 59769 63738
)

PM2="pnpm dlx pm2"

is_protected_pid() {
  local pid="$1"
  [ -z "$pid" ] && return 1
  for proto in "${PROTECTED_PORTS[@]}"; do
    if lsof -nP -iTCP:"$proto" -sTCP:LISTEN -t 2>/dev/null | grep -qx "$pid"; then
      return 0
    fi
  done
  return 1
}

free_pool_ports() {
  for port in "${POOL_PORTS[@]}"; do
    local pids
    pids=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
    [ -z "$pids" ] && continue
    for pid in $pids; do
      if is_protected_pid "$pid"; then
        echo "⛔ Refusing to kill PID $pid on :$port — owns a protected port (${PROTECTED_PORTS[*]})"
        echo "   Free :$port manually or remove the protection, then re-run."
        exit 1
      fi
      echo "🔪 Killing PID $pid holding :$port"
      kill -9 "$pid" 2>/dev/null || true
    done
  done
  sleep 1
}

ensure_builds() {
  echo "🏗  Building workspace (turbo)…"
  pnpm build >/dev/null
  if [ ! -f home/dist/server.js ]; then
    echo "🏗  Building home controller…"
    (cd home && [ -d node_modules ] || npm install >/dev/null)
    (cd home && npx tsc -p tsconfig.json)
  fi
}

cmd_up() {
  echo "🛡  Protected ports: ${PROTECTED_PORTS[*]:-<none>}"
  echo "🎯 Pool ports: ${POOL_PORTS[*]}"
  free_pool_ports
  ensure_builds
  $PM2 start ecosystem.config.cjs
  echo
  $PM2 status
  echo
  echo "⏳ Waiting for music-quiz to respond on :3000…"
  for i in {1..20}; do
    if curl -fsS -o /dev/null http://localhost:3000/quiz/admin; then
      echo "✅ http://localhost:3000/quiz/admin → 200"
      return 0
    fi
    sleep 1
  done
  echo "❌ Timed out waiting for music-quiz. Check: $0 logs music-quiz"
  return 1
}

cmd_down() {
  # SAFETY: only delete entries from our ecosystem file. NEVER `pm2 kill`
  # — the PM2 daemon also hosts apps from other repos (cms-docs, sproutlake,
  # webhouse-site, etc.) and a global kill takes them down too.
  $PM2 delete ecosystem.config.cjs || true
}

cmd_status() {
  $PM2 status
}

cmd_logs() {
  if [ -n "$1" ]; then
    $PM2 logs "$1"
  else
    $PM2 logs
  fi
}

cmd_restart() {
  if [ -n "$1" ]; then
    $PM2 restart "$1"
  else
    $PM2 restart ecosystem.config.cjs
  fi
}

case "${1:-}" in
  up)      cmd_up ;;
  down)    cmd_down ;;
  status)  cmd_status ;;
  logs)    cmd_logs "${2:-}" ;;
  restart) cmd_restart "${2:-}" ;;
  *)
    echo "Usage: $0 {up|down|status|logs [name]|restart [name]}"
    exit 1
    ;;
esac
