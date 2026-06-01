#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/system-mods/SVSKCrashGuard/dist"
VOLUME_NAME="${SVSK_GAME_VOLUME:-stardew-valley-server-kit_game-data}"
SDK_IMAGE="${SVSK_DOTNET_SDK_IMAGE:-mcr.microsoft.com/dotnet/sdk:10.0}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to build SVSK Crash Guard." >&2
  exit 1
fi

mkdir -p "$DIST_DIR"

docker run --rm \
  -v "$ROOT_DIR:/src" \
  -v "$VOLUME_NAME:/game:ro" \
  -w "/src/system-mods/SVSKCrashGuard/src" \
  "$SDK_IMAGE" \
  bash -lc '
    set -euo pipefail
    if [ ! -f /game/StardewModdingAPI.dll ]; then
      echo "StardewModdingAPI.dll was not found in the game-data volume." >&2
      echo "Start/download the server once so SMAPI is installed, then rerun scripts/build-crash-guard.sh." >&2
      exit 2
    fi
    rm -rf /tmp/svsk-crash-guard
    dotnet build -c Release /p:GamePath=/game -o /tmp/svsk-crash-guard
    mkdir -p /src/system-mods/SVSKCrashGuard/dist
    rm -f /src/system-mods/SVSKCrashGuard/dist/manifest.json /src/system-mods/SVSKCrashGuard/dist/SVSKCrashGuard.dll
    cp /src/system-mods/SVSKCrashGuard/src/manifest.json /src/system-mods/SVSKCrashGuard/dist/manifest.json
    cp /tmp/svsk-crash-guard/SVSKCrashGuard.dll /src/system-mods/SVSKCrashGuard/dist/SVSKCrashGuard.dll
  '

echo "SVSK Crash Guard built into system-mods/SVSKCrashGuard/dist."
