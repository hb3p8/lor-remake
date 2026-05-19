#!/usr/bin/env sh
set -eu

PORT="${1:-3001}"
HOST="${2:-0.0.0.0}"

cd "$(dirname "$0")"
exec python3 -m http.server "$PORT" --bind "$HOST"
