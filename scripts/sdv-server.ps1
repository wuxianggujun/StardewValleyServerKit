[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("doctor", "check-env", "login", "download", "steamcmd-download", "smoke", "setup", "start", "stop", "restart", "logs", "status", "update", "backup", "vnc-url", "vnc-proxy", "vnc-check", "vnc-fix", "vnc-resize", "host-auto", "host-visibility")]
    [string]$Action = "setup",

    [string]$SteamUsername,
    [string]$SteamPassword,
    [string]$ServerPassword,
    [int]$Retries = 5,
    [switch]$EnableDiscord,
    [switch]$NoStart
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $RootDir ".env"
$EnvExampleFile = Join-Path $RootDir ".env.example"
$BackupDir = Join-Path $RootDir "backups"
$LogDir = Join-Path $RootDir "logs"
$StableVncParams = "-AcceptPointerEvents=1 -AcceptKeyEvents=1 -AcceptSetDesktopSize=1 -AlwaysShared=1 -DisconnectClients=0"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "OK  $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "WARN $Message" -ForegroundColor Yellow
}

function Write-ErrorExit {
    param([string]$Message)
    Write-Host "ERROR $Message" -ForegroundColor Red
    exit 1
}

function Assert-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Command not found: $Name. Please install Docker Desktop and make sure docker is in PATH."
    }
}

function Invoke-Compose {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$ComposeArgs
    )

    Push-Location $RootDir
    try {
        $argsWithEnv = @("compose", "--env-file", $EnvFile) + $ComposeArgs
        & docker @argsWithEnv
        if ($LASTEXITCODE -ne 0) {
            throw "docker $($argsWithEnv -join ' ') failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

function New-Secret {
    param([int]$Bytes = 32)

    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($buffer)
    }
    finally {
        $rng.Dispose()
    }

    return [Convert]::ToBase64String($buffer).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function ConvertTo-PlainText {
    param([securestring]$SecureText)

    if (-not $SecureText -or $SecureText.Length -eq 0) {
        return ""
    }

    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureText)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

function Get-EnvValue {
    param([string]$Key)

    if (-not (Test-Path $EnvFile)) {
        return ""
    }

    $pattern = "^\s*$([regex]::Escape($Key))\s*=\s*(.*)\s*$"
    foreach ($line in Get-Content -LiteralPath $EnvFile) {
        if ($line -match $pattern) {
            $value = $Matches[1].Trim()
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                return $value.Substring(1, $value.Length - 2)
            }
            return $value
        }
    }

    return ""
}

function Set-EnvValue {
    param(
        [string]$Key,
        [string]$Value
    )

    $escaped = ($Value -replace "\\", "\\") -replace '"', '\"'
    $line = "$Key=`"$escaped`""
    $pattern = "^\s*#?\s*$([regex]::Escape($Key))\s*="

    $content = @()
    if (Test-Path $EnvFile) {
        $content = @(Get-Content -LiteralPath $EnvFile)
    }

    $replaced = $false
    $next = foreach ($item in $content) {
        if (-not $replaced -and $item -match $pattern) {
            $replaced = $true
            $line
        }
        else {
            $item
        }
    }

    if ($replaced) {
        Set-Content -LiteralPath $EnvFile -Value $next -Encoding utf8
    }
    else {
        Add-Content -LiteralPath $EnvFile -Value $line -Encoding utf8
    }
}

function Get-ExternalEnvValue {
    param([string[]]$Names)

    foreach ($name in $Names) {
        foreach ($target in @("Process", "User", "Machine")) {
            $value = [Environment]::GetEnvironmentVariable($name, $target)
            if ($value) {
                return $value
            }
        }
    }

    return ""
}

function Test-SecretValue {
    param([string]$Value)
    if ($Value) {
        return "set"
    }
    return "missing"
}

function Import-SteamEnvIfAvailable {
    $username = Get-ExternalEnvValue @("STEAM_USERNAME", "STEAM_USER", "STEAM_ACCOUNT", "STEAM_LOGIN")
    $password = Get-ExternalEnvValue @("STEAM_PASSWORD", "STEAM_PASS")
    $refreshToken = Get-ExternalEnvValue @("STEAM_REFRESH_TOKEN")

    if (-not (Get-EnvValue "STEAM_USERNAME") -and $username) {
        Set-EnvValue "STEAM_USERNAME" $username
        Write-Ok "Imported STEAM_USERNAME from environment"
    }

    if (-not (Get-EnvValue "STEAM_PASSWORD") -and $password) {
        Set-EnvValue "STEAM_PASSWORD" $password
        Write-Ok "Imported STEAM_PASSWORD from environment"
    }

    if (-not (Get-EnvValue "STEAM_REFRESH_TOKEN") -and $refreshToken) {
        Set-EnvValue "STEAM_REFRESH_TOKEN" $refreshToken
        Write-Ok "Imported STEAM_REFRESH_TOKEN from environment"
    }
}

function Show-CredentialStatus {
    $envUsername = Get-ExternalEnvValue @("STEAM_USERNAME", "STEAM_USER", "STEAM_ACCOUNT", "STEAM_LOGIN")
    $envPassword = Get-ExternalEnvValue @("STEAM_PASSWORD", "STEAM_PASS")
    $envRefreshToken = Get-ExternalEnvValue @("STEAM_REFRESH_TOKEN")

    Write-Host "environment STEAM_USERNAME: $(Test-SecretValue $envUsername)"
    Write-Host "environment STEAM_PASSWORD: $(Test-SecretValue $envPassword)"
    Write-Host "environment STEAM_REFRESH_TOKEN: $(Test-SecretValue $envRefreshToken)"

    if (Test-Path $EnvFile) {
        Write-Host ".env STEAM_USERNAME: $(Test-SecretValue (Get-EnvValue 'STEAM_USERNAME'))"
        Write-Host ".env STEAM_PASSWORD: $(Test-SecretValue (Get-EnvValue 'STEAM_PASSWORD'))"
        Write-Host ".env STEAM_REFRESH_TOKEN: $(Test-SecretValue (Get-EnvValue 'STEAM_REFRESH_TOKEN'))"
    }
    else {
        Write-Warn ".env does not exist"
    }
}

function Protect-LogLine {
    param([string]$Line)

    $protected = $Line
    foreach ($key in @("STEAM_USERNAME", "STEAM_PASSWORD", "STEAM_REFRESH_TOKEN", "VNC_PASSWORD", "API_KEY", "SERVER_PASSWORD", "DISCORD_BOT_TOKEN")) {
        $value = Get-EnvValue $key
        if ($value) {
            $protected = $protected.Replace($value, "<redacted>")
        }
    }

    return $protected
}

function Test-TcpPort {
    param(
        [string]$HostName,
        [int]$Port,
        [int]$TimeoutMs = 3000
    )

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $result = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $result.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
            return $false
        }
        $client.EndConnect($result)
        return $true
    }
    catch {
        return $false
    }
    finally {
        $client.Close()
    }
}

function Get-EnvOrDefault {
    param(
        [string]$Key,
        [string]$DefaultValue
    )

    $value = Get-EnvValue $Key
    if ($value) {
        return $value
    }
    return $DefaultValue
}

function Show-RecentLogs {
    Write-Step "Recent sanitized logs"
    Push-Location $RootDir
    try {
        & docker compose --env-file $EnvFile logs --tail 120 --no-color server steam-auth 2>&1 | ForEach-Object {
            Protect-LogLine ([string]$_)
        }
    }
    finally {
        Pop-Location
    }
}

function Invoke-SmokeTest {
    Ensure-EnvFile

    Write-Step "Starting server stack"
    Invoke-Compose up --detach

    Write-Step "Waiting for containers"
    Start-Sleep -Seconds 15
    Invoke-Compose ps

    $vncPort = [int](Get-EnvOrDefault "VNC_PORT" "5800")
    $apiPort = [int](Get-EnvOrDefault "API_PORT" "8080")

    Write-Step "Checking local TCP ports"
    if (Test-TcpPort "127.0.0.1" $vncPort) {
        Write-Ok "VNC port reachable: $vncPort"
    }
    else {
        Write-Warn "VNC port not reachable yet: $vncPort"
    }

    if (Test-TcpPort "127.0.0.1" $apiPort) {
        Write-Ok "API port reachable: $apiPort"
    }
    else {
        Write-Warn "API port not reachable yet: $apiPort"
    }

    Show-RecentLogs
}

function Invoke-SavesBackup {
    Ensure-EnvFile

    $volumeName = "stardew-valley-server-kit_saves"
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $archiveName = "saves-$timestamp.tar.gz"
    $metadataName = "saves-$timestamp.meta.txt"

    Write-Step "Backing up saves volume"
    Write-Warn "Best practice: run backup after an overnight save, or while the server is stopped."

    $existingVolume = @(& docker volume ls --format "{{.Name}}" --filter "name=$volumeName" 2>$null |
        Where-Object { $_ -eq $volumeName })
    if ($existingVolume.Count -eq 0) {
        Write-ErrorExit "Save volume not found: $volumeName. Start the server once before backing up."
    }

    try {
        $serverRunning = & docker inspect -f "{{.State.Running}}" sdv-server 2>$null
        if ($LASTEXITCODE -eq 0 -and $serverRunning -eq "true") {
            Write-Warn "sdv-server is running. Avoid backing up during the overnight save animation."
        }
    }
    catch {
        # Container may not exist yet; the volume check above is the real requirement.
    }

    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

    $tarCommand = "tar -czf /backup/$archiveName -C /saves ."
    & docker run --rm `
        -v "${volumeName}:/saves:ro" `
        -v "${BackupDir}:/backup" `
        alpine:3.20 sh -c $tarCommand

    if ($LASTEXITCODE -ne 0) {
        Write-ErrorExit "Save backup failed with exit code $LASTEXITCODE"
    }

    $metadata = @(
        "created_at=$(Get-Date -Format o)",
        "volume=$volumeName",
        "archive=$archiveName",
        "note=This file intentionally contains no Steam credentials, API keys, or VNC passwords.",
        "restore_hint=Stop the server, then restore this archive into the saves Docker volume."
    )
    Set-Content -LiteralPath (Join-Path $BackupDir $metadataName) -Value $metadata -Encoding utf8

    Write-Ok "Backup written: backups\$archiveName"
    Write-Ok "Metadata written: backups\$metadataName"
}

function Invoke-NativeVncProxy {
    Assert-Command "node"
    Assert-Command "docker"

    $proxyScript = Join-Path $PSScriptRoot "vnc-proxy.js"
    if (-not (Test-Path $proxyScript)) {
        Write-ErrorExit "VNC proxy script not found: $proxyScript"
    }

    Write-Step "Starting native VNC proxy"
    Write-Warn "Keep this terminal open while using TigerVNC or another native VNC client."
    Write-Warn "Connect the VNC client to 127.0.0.1:5900 and use VNC_PASSWORD from .env."
    Write-Warn "Do not paste VNC_PASSWORD into chat, issues, or screenshots."
    & node $proxyScript
}

function Show-NoVncUrl {
    Ensure-EnvFile

    $password = Get-EnvValue "VNC_PASSWORD"
    if (-not $password) {
        Write-ErrorExit "VNC_PASSWORD is not set in .env. Run setup first."
    }

    $vncPort = Get-EnvOrDefault "VNC_PORT" "5800"
    $encodedPassword = [System.Uri]::EscapeDataString($password)
    $url = "http://127.0.0.1:$vncPort/?shared=true&resize=scale&path=websockify&password=$encodedPassword"

    Write-Step "noVNC URL"
    Write-Warn "This URL contains VNC_PASSWORD. Do not share it in chat, issues, logs, or screenshots."
    Write-Host $url
}

function Update-StardewVncResolution {
    Ensure-EnvFile

    $displayWidth = Get-EnvOrDefault "DISPLAY_WIDTH" "1920"
    $displayHeight = Get-EnvOrDefault "DISPLAY_HEIGHT" "1080"
    $volumeName = "stardew-valley-server-kit_saves"
    $tempScript = Join-Path ([System.IO.Path]::GetTempPath()) ("sdv-vnc-update-{0}.sh" -f ([Guid]::NewGuid().ToString("N")))

    Write-Step "Aligning Stardew Valley resolution with VNC desktop"
    Write-Warn "This updates the game's saved startup preferences inside the game volume. Saves are preserved."

    & docker volume inspect $volumeName *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "Save/config volume not found: $volumeName. Start the server once, then run vnc-fix again."
        return
    }

    $fixScript = @'
set -eu
stamp="$(date +%Y%m%d-%H%M%S)"
for file in /config/startup_preferences /config/default_options; do
  if [ ! -f "$file" ]; then
    echo "WARN missing $file"
    continue
  fi
  cp "$file" "$file.bak-$stamp"
  sed -i -E -e "s|<fullscreenResolutionX>[^<]*</fullscreenResolutionX>|<fullscreenResolutionX>${DISPLAY_WIDTH}</fullscreenResolutionX>|g" -e "s|<fullscreenResolutionY>[^<]*</fullscreenResolutionY>|<fullscreenResolutionY>${DISPLAY_HEIGHT}</fullscreenResolutionY>|g" -e "s|<preferredResolutionX>[^<]*</preferredResolutionX>|<preferredResolutionX>${DISPLAY_WIDTH}</preferredResolutionX>|g" -e "s|<preferredResolutionY>[^<]*</preferredResolutionY>|<preferredResolutionY>${DISPLAY_HEIGHT}</preferredResolutionY>|g" -e "s|<uiScale>[^<]*</uiScale>|<uiScale>1</uiScale>|g" "$file"
  echo "OK updated $file"
done
'@

    try {
        [System.IO.File]::WriteAllText($tempScript, ($fixScript -replace "`r`n", "`n"), [System.Text.Encoding]::ASCII)

        & docker run --rm `
            -e "DISPLAY_WIDTH=$displayWidth" `
            -e "DISPLAY_HEIGHT=$displayHeight" `
            --mount "type=bind,source=$tempScript,target=/tmp/fix.sh,readonly" `
            -v "${volumeName}:/config" `
            alpine:3.20 sh /tmp/fix.sh

        if ($LASTEXITCODE -ne 0) {
            Write-ErrorExit "Failed to update Stardew Valley VNC resolution preferences."
        }
    }
    finally {
        Remove-Item -LiteralPath $tempScript -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-VncRuntimeResize {
    $serverRunning = $false
    $inspectOutput = & docker inspect -f "{{.State.Running}}" sdv-server 2>$null
    if ($LASTEXITCODE -eq 0 -and $inspectOutput -eq "true") {
        $serverRunning = $true
    }

    if (-not $serverRunning) {
        Write-Warn "sdv-server is not running. Skipping live X11 resize."
        return
    }

    Write-Step "Forcing live VNC desktop size"
    Write-Warn "If noVNC is open with resize=remote, it can shrink the remote desktop again. Use resize=scale for a fixed .env size."
    $resizeScript = @'
set -eu
width="${DISPLAY_WIDTH:-1920}"
height="${DISPLAY_HEIGHT:-1080}"
mode="${width}x${height}"
if DISPLAY=:0 xrandr | awk '{print $1}' | grep -Fxq "$mode"; then
  DISPLAY=:0 xrandr --output VNC-0 --mode "$mode" || DISPLAY=:0 xrandr -s "$mode" || true
else
  DISPLAY=:0 xrandr --fb "$mode" || true
fi
win="$(DISPLAY=:0 wmctrl -l | awk '/Stardew Valley/ {print $1; exit}')"
if [ -n "$win" ]; then
  DISPLAY=:0 wmctrl -ir "$win" -b remove,maximized_vert,maximized_horz || true
  DISPLAY=:0 wmctrl -ir "$win" -e "0,0,0,$width,$height" || true
  DISPLAY=:0 wmctrl -ir "$win" -b add,maximized_vert,maximized_horz || true
fi
DISPLAY=:0 xrandr | sed -n "1,4p"
DISPLAY=:0 wmctrl -lG | grep -i "Stardew" || true
'@
    $tempScript = Join-Path ([System.IO.Path]::GetTempPath()) ("sdv-vnc-resize-{0}.sh" -f ([Guid]::NewGuid().ToString("N")))

    try {
        [System.IO.File]::WriteAllText($tempScript, ($resizeScript -replace "`r`n", "`n"), [System.Text.Encoding]::ASCII)
        & docker cp $tempScript "sdv-server:/tmp/vnc-resize.sh"
        if ($LASTEXITCODE -ne 0) {
            Write-ErrorExit "Failed to copy live resize script into sdv-server."
        }

        & docker exec sdv-server sh /tmp/vnc-resize.sh
        if ($LASTEXITCODE -ne 0) {
            Write-ErrorExit "Failed to run live resize script inside sdv-server."
        }
    }
    finally {
        & docker exec sdv-server rm -f /tmp/vnc-resize.sh *> $null
        Remove-Item -LiteralPath $tempScript -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-VncInputCheck {
    Write-Step "Checking VNC input configuration"
    $renderingDisabled = Get-EnvOrDefault "DISABLE_RENDERING" "false"
    $vncParams = Get-EnvOrDefault "XVNC_SERVER_CUSTOM_PARAMS" $StableVncParams

    if (-not (Test-Path $EnvFile)) {
        Write-Warn ".env does not exist. Showing default VNC settings; run setup or vnc-fix to write local configuration."
    }

    Write-Host "DISABLE_RENDERING=$renderingDisabled"
    Write-Host "XVNC_SERVER_CUSTOM_PARAMS=$vncParams"

    if ($renderingDisabled -eq "true") {
        Write-Warn "DISABLE_RENDERING=true is not recommended when you need interactive VNC controls."
    }

    if ($vncParams -match "(^|\s)-RawKeyboard=1(\s|$)") {
        Write-Warn "RawKeyboard is enabled. Some VNC clients send keys in a way Stardew Valley does not handle reliably."
    }

    if ($vncParams -notmatch "(^|\s)-AcceptSetDesktopSize=1(\s|$)") {
        Write-Warn "AcceptSetDesktopSize is not explicit. Run vnc-fix so VNC clients that support remote resize can request desktop-size changes."
    }

    $serverRunning = $false
    $inspectOutput = & docker inspect -f "{{.State.Running}}" sdv-server 2>$null
    if ($LASTEXITCODE -eq 0 -and $inspectOutput -eq "true") {
        $serverRunning = $true
    }

    if (-not $serverRunning) {
        Write-Warn "sdv-server is not running. Start it before testing live VNC input."
        return
    }

    Write-Step "Runtime Xvnc process"
    & docker exec sdv-server sh -lc "ps -ef | grep '[X]vnc' | sed -E 's/-rfbauth=[^ ]+/-rfbauth=<path>/'"

    Write-Step "Active X11 window"
    & docker exec sdv-server sh -lc "DISPLAY=:0 xprop -root _NET_ACTIVE_WINDOW 2>/dev/null; DISPLAY=:0 wmctrl -l -p -G 2>/dev/null || true"

    Write-Step "VNC desktop size"
    & docker exec sdv-server sh -lc 'echo "target=${DISPLAY_WIDTH}x${DISPLAY_HEIGHT}"; DISPLAY=:0 xrandr 2>/dev/null | sed -n "1,4p" || true'

    Write-Step "Manual mouse/keyboard probe"
    Write-Host "Use a temporary xev window to test the VNC input path:"
    Write-Host 'docker exec -it sdv-server sh -lc "DISPLAY=:0 timeout 30 xev -geometry 260x160+40+40 -event mouse -event keyboard"'
    Write-Host "Then click inside the small xev window in noVNC and press F9/F10."
    Write-Host "Expected output contains ButtonPress/ButtonRelease and KeyPress/KeyRelease."
    Write-Host "Do not use the JunimoServer overlay labels as a click test; they are status/hotkey hints."
}

function Invoke-VncInputFix {
    Ensure-EnvFile

    Write-Step "Applying VNC interactive settings"
    Set-EnvValue "DISABLE_RENDERING" "false"
    Set-EnvValue "XVNC_SERVER_CUSTOM_PARAMS" $StableVncParams
    Write-Ok "Set DISABLE_RENDERING=false"
    Write-Ok "Enabled pointer, keyboard, and remote desktop resize events"
    Write-Ok "Removed RawKeyboard from XVNC_SERVER_CUSTOM_PARAMS"

    Write-Step "Stopping server before updating game resolution"
    Write-Warn "Only the server container is stopped. Docker volumes containing game files and saves are preserved."
    Invoke-Compose stop server

    Update-StardewVncResolution

    Write-Step "Starting server container"
    Invoke-Compose up --detach --force-recreate server

    Write-Step "Waiting for VNC to come back"
    Start-Sleep -Seconds 12
    Invoke-VncRuntimeResize
    Invoke-VncInputCheck
}

function Invoke-SmapiCommand {
    param(
        [string]$Command,
        [string]$Description
    )

    $serverRunning = $false
    $inspectOutput = & docker inspect -f "{{.State.Running}}" sdv-server 2>$null
    if ($LASTEXITCODE -eq 0 -and $inspectOutput -eq "true") {
        $serverRunning = $true
    }

    if (-not $serverRunning) {
        Write-ErrorExit "sdv-server is not running. Start it before sending JunimoServer commands."
    }

    Write-Step $Description
    Write-Warn "This sends a SMAPI console command to the running server. It does not restart the container or edit saves."

    $commandScript = "set -eu; test -p /tmp/smapi-input || { echo 'SMAPI input pipe not found'; exit 1; }; printf '%s\n' '$Command' > /tmp/smapi-input; sleep 1; tail -n 40 /tmp/server-output.log | grep -E 'Host automation|Host visibility|host-auto|host-visibility' | tail -n 10 || true"
    & docker exec sdv-server sh -lc $commandScript 2>&1 | ForEach-Object {
        Protect-LogLine ([string]$_)
    }

    if ($LASTEXITCODE -ne 0) {
        Write-ErrorExit "Failed to send SMAPI command: $Command"
    }
}

function Initialize-SteamCmdVolumes {
    param(
        [string]$Image,
        [string]$GameVolume,
        [string]$SteamCmdVolume
    )

    Write-Step "Preparing SteamCMD volumes"
    $prepareCommand = "mkdir -p /data/game /home/steam/Steam && chown -R steam:steam /data/game /home/steam/Steam"
    & docker run --rm --user 0:0 `
        -v "${GameVolume}:/data/game" `
        -v "${SteamCmdVolume}:/home/steam/Steam" `
        --entrypoint bash `
        $Image -lc $prepareCommand | Out-Null

    if ($LASTEXITCODE -ne 0) {
        Write-ErrorExit "Failed to prepare SteamCMD volumes. Check Docker Desktop and volume permissions."
    }
}

function Test-GameDataInstalled {
    param(
        [string]$GameVolume
    )

    $testCommand = "test -f /data/game/StardewValley -o -f /data/game/StardewValley.exe"
    & docker run --rm `
        -v "${GameVolume}:/data/game:ro" `
        alpine:3.20 sh -c $testCommand | Out-Null

    return ($LASTEXITCODE -eq 0)
}

function Copy-SteamCmdCacheToGameData {
    param(
        [string]$GameVolume,
        [string]$SteamCmdVolume
    )

    Write-Step "Checking SteamCMD cache fallback"
    $copyCommand = @"
set -eu
if [ ! -f '/home/steam/Steam/steamapps/common/Stardew Valley/StardewValley' ] && [ ! -f '/home/steam/Steam/steamapps/common/Stardew Valley/StardewValley.exe' ]; then
  echo 'SteamCMD cache does not contain Stardew Valley game files.'
  exit 1
fi
rm -rf /data/game/.steam_tmp_copy
mkdir -p /data/game/.steam_tmp_copy
cp -a '/home/steam/Steam/steamapps/common/Stardew Valley/.' /data/game/.steam_tmp_copy/
find /data/game -mindepth 1 -maxdepth 1 ! -name '.steam_tmp_copy' -exec rm -rf {} +
cp -a /data/game/.steam_tmp_copy/. /data/game/
rm -rf /data/game/.steam_tmp_copy
chown -R 1000:1000 /data/game
"@

    & docker run --rm --user 0:0 `
        -v "${SteamCmdVolume}:/home/steam/Steam:ro" `
        -v "${GameVolume}:/data/game" `
        alpine:3.20 sh -c $copyCommand | ForEach-Object {
            Protect-LogLine ([string]$_)
        }

    if ($LASTEXITCODE -ne 0) {
        Write-ErrorExit "SteamCMD reported success, but game files were not found in game-data or cache volumes."
    }
}

function Assert-GameDataInstalled {
    param(
        [string]$GameVolume,
        [string]$SteamCmdVolume
    )

    if (-not (Test-GameDataInstalled $GameVolume)) {
        Copy-SteamCmdCacheToGameData $GameVolume $SteamCmdVolume
    }

    if (-not (Test-GameDataInstalled $GameVolume)) {
        Write-ErrorExit "Game files are still missing from the game-data volume after fallback copy."
    }

    $inspectCommand = "printf 'game-data files='; find /data/game -type f | wc -l; du -sh /data/game | awk '{print `$1}'"
    & docker run --rm `
        -v "${GameVolume}:/data/game:ro" `
        alpine:3.20 sh -c $inspectCommand | ForEach-Object {
            Write-Host $_
        }

    Write-Ok "Game files are available in the game-data volume"
}

function Initialize-SteamSdkDir {
    param([string]$GameVolume)

    $command = "mkdir -p /data/game/.steam-sdk && chown -R 0:0 /data/game/.steam-sdk && chmod -R 777 /data/game/.steam-sdk"
    & docker run --rm --user 0:0 `
        -v "${GameVolume}:/data/game" `
        alpine:3.20 sh -c $command | Out-Null

    if ($LASTEXITCODE -ne 0) {
        Write-ErrorExit "Failed to prepare Steamworks SDK directory."
    }
}

function Install-SteamworksSdk {
    param(
        [string]$Image,
        [string]$GameVolume,
        [string]$SteamCmdVolume
    )

    Write-Step "Installing Steamworks SDK redistributable"
    Initialize-SteamSdkDir $GameVolume

    $sdkCommand = '/home/steam/steamcmd/steamcmd.sh +force_install_dir /data/game/.steam-sdk +login anonymous +app_update 1007 validate +quit'
    & docker run --rm `
        -v "${GameVolume}:/data/game" `
        -v "${SteamCmdVolume}:/home/steam/Steam" `
        $Image `
        bash -lc $sdkCommand 2>&1 | ForEach-Object {
            Protect-LogLine ([string]$_)
        }

    if ($LASTEXITCODE -ne 0) {
        Write-ErrorExit "Steamworks SDK download failed with exit code $LASTEXITCODE."
    }

    $checkCommand = "test -f /data/game/.steam-sdk/linux64/steamclient.so -o -f /data/game/.steam-sdk/steamclient.so"
    & docker run --rm `
        -v "${GameVolume}:/data/game:ro" `
        alpine:3.20 sh -c $checkCommand | Out-Null

    if ($LASTEXITCODE -ne 0) {
        Write-ErrorExit "Steamworks SDK download finished, but steamclient.so was not found."
    }

    & docker run --rm --user 0:0 `
        -v "${GameVolume}:/data/game" `
        alpine:3.20 sh -c "chown -R 1000:1000 /data/game/.steam-sdk" | Out-Null

    Write-Ok "Steamworks SDK is available in game-data"
}

function Invoke-SteamCmdDownload {
    Ensure-EnvFile

    $steamUser = Get-EnvValue "STEAM_USERNAME"
    $steamPass = Get-EnvValue "STEAM_PASSWORD"
    if (-not $steamUser -or -not $steamPass) {
        Write-ErrorExit "STEAM_USERNAME or STEAM_PASSWORD is missing in .env."
    }

    $maxAttempts = [Math]::Max(1, $Retries)
    $image = "cm2network/steamcmd:latest"
    $gameVolume = "stardew-valley-server-kit_game-data"
    $steamCmdVolume = "stardew-valley-server-kit_steamcmd"
    $downloadCommand = '/home/steam/steamcmd/steamcmd.sh +@sSteamCmdForcePlatformType linux +force_install_dir /data/game +login "$STEAM_USERNAME" "$STEAM_PASSWORD" +app_update 413150 validate +quit'
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

    Write-Step "Downloading game files with SteamCMD"
    Write-Warn "Steam Guard codes must be typed into this terminal. Do not paste codes into chat or issues."
    Initialize-SteamCmdVolumes $image $gameVolume $steamCmdVolume

    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        Write-Step "SteamCMD attempt $attempt of $maxAttempts"
        $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $logFile = Join-Path $LogDir "steamcmd-download-$timestamp-attempt-$attempt.log"
        $oldPreference = $ErrorActionPreference
        $oldSteamUsername = $env:STEAM_USERNAME
        $oldSteamPassword = $env:STEAM_PASSWORD
        $exitCode = 1
        try {
            $ErrorActionPreference = "Continue"
            $env:STEAM_USERNAME = $steamUser
            $env:STEAM_PASSWORD = $steamPass
            & docker run --rm -i `
                -v "${gameVolume}:/data/game" `
                -v "${steamCmdVolume}:/home/steam/Steam" `
                -e STEAM_USERNAME `
                -e STEAM_PASSWORD `
                $image `
                bash -lc $downloadCommand 2>&1 | ForEach-Object {
                    $line = Protect-LogLine ([string]$_)
                    Add-Content -LiteralPath $logFile -Value $line -Encoding utf8
                    Write-Host $line
                }
            $exitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $oldPreference
            if ($null -eq $oldSteamUsername) {
                Remove-Item Env:\STEAM_USERNAME -ErrorAction SilentlyContinue
            }
            else {
                $env:STEAM_USERNAME = $oldSteamUsername
            }
            if ($null -eq $oldSteamPassword) {
                Remove-Item Env:\STEAM_PASSWORD -ErrorAction SilentlyContinue
            }
            else {
                $env:STEAM_PASSWORD = $oldSteamPassword
            }
        }

        if ($exitCode -eq 0) {
            Assert-GameDataInstalled $gameVolume $steamCmdVolume
            Install-SteamworksSdk $image $gameVolume $steamCmdVolume
            Write-Ok "SteamCMD download completed"
            Write-Ok "Log written: logs\$(Split-Path -Leaf $logFile)"
            return
        }

        Write-Warn "SteamCMD failed with exit code $exitCode"
        Write-Warn "Log written: logs\$(Split-Path -Leaf $logFile)"
        if ($attempt -lt $maxAttempts) {
            $delay = [Math]::Min(60, 10 * $attempt)
            Write-Warn "Retrying in $delay seconds. Partial files in the game volume will be reused."
            Start-Sleep -Seconds $delay
        }
    }

    Write-ErrorExit "SteamCMD download failed after $maxAttempts attempts. See docs\STEAM_DOWNLOAD_FALLBACK.md."
}

function Ensure-EnvFile {
    if (-not (Test-Path $EnvFile)) {
        Copy-Item -LiteralPath $EnvExampleFile -Destination $EnvFile
        Write-Ok "Created .env from .env.example"
    }

    Import-SteamEnvIfAvailable

    if (-not (Get-EnvValue "VNC_PASSWORD")) {
        Set-EnvValue "VNC_PASSWORD" (New-Secret 18)
    }

    if (-not (Get-EnvValue "API_KEY")) {
        Set-EnvValue "API_KEY" (New-Secret 32)
    }

    if ($ServerPassword) {
        Set-EnvValue "SERVER_PASSWORD" $ServerPassword
    }

    if ($SteamUsername) {
        Set-EnvValue "STEAM_USERNAME" $SteamUsername
    }
    elseif (-not (Get-EnvValue "STEAM_USERNAME")) {
        $inputName = Read-Host "Steam username (must own Stardew Valley; leave blank to edit .env later)"
        if ($inputName) {
            Set-EnvValue "STEAM_USERNAME" $inputName
        }
    }

    if ($SteamPassword) {
        Set-EnvValue "STEAM_PASSWORD" $SteamPassword
    }
    elseif (-not (Get-EnvValue "STEAM_PASSWORD")) {
        Write-Host "Steam password will be written to local .env. Leave blank if you prefer manual steam-auth setup."
        $inputPassword = ConvertTo-PlainText (Read-Host "Steam password (hidden input; optional)" -AsSecureString)
        if ($inputPassword) {
            Set-EnvValue "STEAM_PASSWORD" $inputPassword
        }
    }

    New-Item -ItemType Directory -Force -Path (Join-Path $RootDir "data\settings"), (Join-Path $RootDir "data\mods") | Out-Null
}

function Assert-Docker {
    Assert-Command "docker"
    & docker version | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker is not running. Please start Docker Desktop and retry."
    }
}

function Assert-ComposeConfig {
    param([string]$ComposeEnvFile)

    Push-Location $RootDir
    try {
        & docker compose --env-file $ComposeEnvFile config --quiet
        if ($LASTEXITCODE -ne 0) {
            throw "docker compose config validation failed."
        }
    }
    finally {
        Pop-Location
    }
}

function Test-DockerImage {
    param([string]$Image)

    & docker image inspect $Image | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Image available: $Image"
        return
    }

    Write-Warn "Image not found locally: $Image"
    Write-Host "     Run: docker pull $Image"
}

function Get-UpArgs {
    if ($EnableDiscord) {
        return @("--profile", "discord", "up", "-d")
    }

    return @("up", "-d")
}

Write-Step "Checking Docker"
Assert-Docker

switch ($Action) {
    "doctor" {
        Write-Step "Checking Docker Compose"
        & docker compose version
        if ($LASTEXITCODE -ne 0) {
            throw "Docker Compose is not available."
        }
        Write-Ok "Docker Compose available"

        Write-Step "Validating docker-compose.yml"
        Assert-ComposeConfig $EnvExampleFile
        Write-Ok "Compose config OK"

        Write-Step "Checking Docker images"
        $imageVersion = "preview"
        if (Test-Path $EnvFile) {
            $configuredVersion = Get-EnvValue "IMAGE_VERSION"
            if ($configuredVersion) {
                $imageVersion = $configuredVersion
            }
        }
        Test-DockerImage "sdvd/server:$imageVersion"
        Test-DockerImage "sdvd/steam-service:$imageVersion"
        Test-DockerImage "sdvd/discord-bot:$imageVersion"

        Write-Step "Checking local directories"
        New-Item -ItemType Directory -Force -Path (Join-Path $RootDir "data\settings"), (Join-Path $RootDir "data\mods") | Out-Null
        Write-Ok "data/settings and data/mods ready"

        if (Test-Path $EnvFile) {
            Write-Ok ".env exists; sensitive values are not printed"
        }
        else {
            Write-Warn ".env does not exist yet; run setup or copy .env.example before real Steam auth"
        }
    }
    "check-env" {
        Write-Step "Checking Steam credential visibility"
        Show-CredentialStatus
    }
    "login" {
        Ensure-EnvFile
        Write-Step "Running Steam login"
        Invoke-Compose run --rm -it steam-auth login
    }
    "download" {
        Ensure-EnvFile
        Write-Step "Downloading or updating game files"
        Invoke-Compose run --rm steam-auth download
    }
    "steamcmd-download" {
        Invoke-SteamCmdDownload
    }
    "smoke" {
        Invoke-SmokeTest
    }
    "setup" {
        Write-Step "Preparing .env"
        Ensure-EnvFile

        Write-Step "Pulling Docker images"
        Invoke-Compose pull

        Write-Step "Running Steam login"
        Invoke-Compose run --rm -it steam-auth login

        Write-Step "Downloading or updating game files"
        Invoke-Compose run --rm steam-auth download

        if (-not $NoStart) {
            Invoke-SmokeTest
        }
    }
    "start" {
        Ensure-EnvFile
        Write-Step "Starting server"
        $upArgs = Get-UpArgs
        Invoke-Compose @upArgs
    }
    "stop" {
        Write-Step "Stopping server"
        Invoke-Compose down
    }
    "restart" {
        Ensure-EnvFile
        Write-Step "Restarting server"
        Invoke-Compose down
        $upArgs = Get-UpArgs
        Invoke-Compose @upArgs
    }
    "logs" {
        Ensure-EnvFile
        Write-Step "Following logs; press Ctrl+C to exit"
        Invoke-Compose logs -f
    }
    "status" {
        Ensure-EnvFile
        Write-Step "Showing container status"
        Invoke-Compose ps
    }
    "update" {
        Ensure-EnvFile
        Write-Step "Updating images and restarting"
        Invoke-Compose pull
        Invoke-Compose down
        $upArgs = Get-UpArgs
        Invoke-Compose @upArgs
    }
    "backup" {
        Invoke-SavesBackup
    }
    "vnc-url" {
        Show-NoVncUrl
    }
    "vnc-proxy" {
        Invoke-NativeVncProxy
    }
    "vnc-check" {
        Invoke-VncInputCheck
    }
    "vnc-fix" {
        Invoke-VncInputFix
    }
    "vnc-resize" {
        Invoke-VncRuntimeResize
    }
    "host-auto" {
        Invoke-SmapiCommand "host-auto" "Toggling JunimoServer host auto mode"
    }
    "host-visibility" {
        Invoke-SmapiCommand "host-visibility" "Toggling JunimoServer host visibility"
    }
}
