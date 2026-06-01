param(
    [string]$GameVolume = $env:SVSK_GAME_VOLUME,
    [string]$SdkImage = $env:SVSK_DOTNET_SDK_IMAGE
)

$ErrorActionPreference = "Stop"
$rootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($GameVolume)) {
    $GameVolume = "stardew-valley-server-kit_game-data"
}
if ([string]::IsNullOrWhiteSpace($SdkImage)) {
    $SdkImage = "mcr.microsoft.com/dotnet/sdk:10.0"
}

docker run --rm `
    -v "${rootDir}:/src" `
    -v "${GameVolume}:/game:ro" `
    -w "/src/system-mods/SVSKCrashGuard/src" `
    $SdkImage `
    bash -lc @'
set -euo pipefail
if [ ! -f /game/StardewModdingAPI.dll ]; then
  echo "StardewModdingAPI.dll was not found in the game-data volume." >&2
  echo "Start/download the server once so SMAPI is installed, then rerun scripts/build-crash-guard.ps1." >&2
  exit 2
fi
rm -rf /tmp/svsk-crash-guard
dotnet build -c Release /p:GamePath=/game -o /tmp/svsk-crash-guard
mkdir -p /src/system-mods/SVSKCrashGuard/dist
rm -f /src/system-mods/SVSKCrashGuard/dist/manifest.json /src/system-mods/SVSKCrashGuard/dist/SVSKCrashGuard.dll
cp /src/system-mods/SVSKCrashGuard/src/manifest.json /src/system-mods/SVSKCrashGuard/dist/manifest.json
cp /tmp/svsk-crash-guard/SVSKCrashGuard.dll /src/system-mods/SVSKCrashGuard/dist/SVSKCrashGuard.dll
'@

Write-Host "SVSK Crash Guard built into system-mods/SVSKCrashGuard/dist."
