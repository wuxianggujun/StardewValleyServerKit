#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTION="${1:-build-setup}"
if [[ $# -gt 0 ]]; then
  shift
fi

exec "$SCRIPT_DIR/scripts/sdv-server.sh" "$ACTION" "$@"
