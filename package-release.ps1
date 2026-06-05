[CmdletBinding()]
param(
    [string]$ImageNamespace,
    [string]$ImageVersion,
    [string]$OutputDir,
    [string]$ServerSource,
    [string]$SteamServiceSource,
    [string]$DiscordBotSource,
    [switch]$RequireSourceBuildPackage
)

$ErrorActionPreference = "Stop"

$RootDir = $PSScriptRoot
if (-not $OutputDir) {
    $OutputDir = Join-Path $RootDir "dist"
}
elseif (-not [System.IO.Path]::IsPathRooted($OutputDir)) {
    $OutputDir = Join-Path $RootDir $OutputDir
}

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

function Get-EnvValueFromFile {
    param(
        [string]$Path,
        [string]$Key
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return ""
    }

    $pattern = "^\s*$([regex]::Escape($Key))\s*=\s*(.*)\s*$"
    foreach ($line in Get-Content -LiteralPath $Path) {
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

function Resolve-SourcePath {
    param(
        [string]$Path,
        [string]$DefaultRelativePath
    )

    if (-not $Path) {
        $Path = Join-Path $RootDir $DefaultRelativePath
    }
    elseif (-not [System.IO.Path]::IsPathRooted($Path)) {
        $Path = Join-Path $RootDir $Path
    }

    return $Path
}

$EnvExampleFile = Join-Path $RootDir ".env.example"
if (-not $ImageNamespace) {
    $ImageNamespace = Get-EnvValueFromFile $EnvExampleFile "IMAGE_NAMESPACE"
}
if (-not $ImageNamespace) {
    $ImageNamespace = "sdvd"
}
if (-not $ImageVersion) {
    $ImageVersion = Get-EnvValueFromFile $EnvExampleFile "IMAGE_VERSION"
}
if (-not $ImageVersion) {
    $ImageVersion = "preview"
}

$ServerSource = Resolve-SourcePath $ServerSource "server"
$SteamServiceSource = Resolve-SourcePath $SteamServiceSource "steam-service"
$DiscordBotSource = Resolve-SourcePath $DiscordBotSource "discord-bot"

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stagingRoot = Join-Path $OutputDir ".stage\$stamp"

$rootSkip = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($name in @(
    ".git", ".github", ".gitattributes", ".gitignore",
    ".ace-tool", ".claude", ".idea", ".vscode",
    "dist", "data", "backups", "logs",
    ".env", ".env.local", "docker-compose.build.yml",
    "CONTRIBUTING.md",
    "release-images.ps1", "release-images.sh",
    "package-release.ps1", "package-release.sh"
)) {
    [void]$rootSkip.Add($name)
}

$treeSkip = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($name in @("bin", "obj", "node_modules", ".git", ".pytest_cache")) {
    [void]$treeSkip.Add($name)
}

function Copy-FilteredTree {
    param(
        [string]$Source,
        [string]$Destination,
        [switch]$Root
    )

    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
        if ($Root -and $rootSkip.Contains($item.Name)) {
            continue
        }
        if ($item.PSIsContainer -and $treeSkip.Contains($item.Name)) {
            continue
        }

        $target = Join-Path $Destination $item.Name
        if ($item.PSIsContainer) {
            Copy-FilteredTree -Source $item.FullName -Destination $target
        }
        else {
            Copy-Item -LiteralPath $item.FullName -Destination $target
        }
    }
}

function Set-PackageEnvDefaults {
    param([string]$PackageRoot)

    $envPath = Join-Path $PackageRoot ".env.example"
    if (-not (Test-Path -LiteralPath $envPath)) {
        return
    }

    $lines = Get-Content -LiteralPath $envPath
    $lines = $lines | ForEach-Object {
        if ($_ -match "^\s*IMAGE_NAMESPACE\s*=") {
            "IMAGE_NAMESPACE=$ImageNamespace"
        }
        elseif ($_ -match "^\s*IMAGE_VERSION\s*=") {
            "IMAGE_VERSION=$ImageVersion"
        }
        else {
            $_
        }
    }
    Set-Utf8NoBomContent -Path $envPath -Content (($lines -join "`n") + "`n")
}

function Set-Utf8NoBomContent {
    param(
        [string]$Path,
        [string]$Content
    )

    $encoding = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Remove-PullPackageBuildEntries {
    param([string]$PackageRoot)

    foreach ($relativePath in @(
        "setup-build.ps1",
        "setup-build.sh",
        "setup-local-build.ps1",
        "docker-compose.build.yml.example",
        "scripts\sdv-server-local-build.sh"
    )) {
        $path = Join-Path $PackageRoot $relativePath
        if (Test-Path -LiteralPath $path) {
            Remove-Item -LiteralPath $path -Force
        }
    }
}

function Write-Quickstart {
    param(
        [string]$PackageRoot,
        [ValidateSet("pull", "source-build")]
        [string]$PackageType
    )

    $quickstartPath = Join-Path $PackageRoot "QUICKSTART.md"
    if ($PackageType -eq "source-build") {
        $content = @'
# Stardew Valley Server Kit - Source Build Quickstart

This package is for maintainers or advanced users who want to build Docker images on the target server.

## Linux server

```bash
mkdir -p stardew-valley-server-kit
cd stardew-valley-server-kit
# unzip the release archive here
chmod +x ./setup-build.sh
./setup-build.sh doctor
./setup-build.sh
```

If Docker is missing, install Docker Engine with Compose v2 first. On Ubuntu/Debian:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

This package must contain these build inputs:

- server/Dockerfile
- steam-service/Dockerfile
- discord-bot/Dockerfile

## Useful commands

```bash
./setup-build.sh status
./setup-build.sh logs
./setup-build.sh restart
./setup-build.sh update
./setup-build.sh join-info
./scripts/sdv-server.sh admin-service-install
./scripts/sdv-server.sh admin-service-install-public
```
'@
    }
    else {
        $content = @'
# Stardew Valley Server Kit - Server Quickstart

This package is for normal server owners. It pulls published Docker images and does not require source code.

Project mirror for China users:

- Gitee: https://gitee.com/wuxianggujun/StardewValleyServerKit

Images configured in this package:

- __IMAGE_NAMESPACE__/server:__IMAGE_VERSION__
- __IMAGE_NAMESPACE__/steam-service:__IMAGE_VERSION__
- __IMAGE_NAMESPACE__/discord-bot:__IMAGE_VERSION__

## Linux server

```bash
mkdir -p stardew-valley-server-kit
cd stardew-valley-server-kit
# unzip the release archive here
chmod +x ./setup.sh
./setup.sh doctor
./setup.sh
```

`./setup.sh` without arguments opens an interactive menu. Use option 2 to
fill or update Steam username/password, then option 1 to run the one-click
setup/deploy/repair flow. Steam passwords are saved only in local `.env` and
are not printed.

If Docker is missing, install Docker Engine with Compose v2 first. On Ubuntu/Debian:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

If Docker Hub is slow or unreachable, `./setup.sh` first tries the normal pull path.
After a confirmed registry timeout, it can ask whether to temporarily configure Docker
registry mirrors and restart Docker. Type `yes` only if this server can tolerate a
brief interruption of other Docker containers. The script restores the original
`/etc/docker/daemon.json` after image downloads finish.

## Useful commands

```bash
./setup.sh menu
./setup.sh doctor
./setup.sh steam-config
./setup.sh access-info
./setup.sh status
./setup.sh logs
./setup.sh restart
./setup.sh update
./setup.sh join-info
./setup.sh admin-token-show
./setup.sh admin-token-rotate
./scripts/sdv-server.sh admin-detect
./scripts/sdv-server.sh admin-service-install
./scripts/sdv-server.sh admin-service-install-public
```

`admin-service-install` is for Nginx/1Panel reverse proxy mode on
`127.0.0.1:8088`. `admin-service-install-public` is for a bare public
server without reverse proxy; open TCP 8088 in the cloud security group and
visit `http://<server-public-ip>:8088`.

Interactive Linux setup detects common reverse proxy candidates and recommends a
mode, but still asks the user to choose because installed reverse proxy software
does not prove a site is configured for this project.

The web admin login uses ADMIN_TOKEN from local .env. To copy it without opening
.env manually, run `./setup.sh admin-token-show` from an interactive terminal
and type `SHOW`. The token is not printed during normal setup, status, or logs.

## Saves and custom farms

After deployment, open the web admin panel and use the Saves page instead of
editing Docker volumes by hand.

- To create your real farm, click Create map, fill the farm name, map type,
  cabin/player settings, and profit margin, then confirm.
- To switch saves, select the save for next load and restart the game server.
- To delete the default/test save, make sure players are offline, click Delete
  on that save, and type the full save name to confirm.
- Before deleting a save, the panel backs up the whole saves volume and then
  removes only the selected save directory.
- Restoring a backup replaces the whole saves volume, not just one save.

If the server has no Node.js 18+, the Linux script can download a project-local
Node.js runtime into `.svsk-tools/`. Interactive runs ask first; non-interactive
runs can set `SVSK_AUTO_INSTALL_NODE=true`.

Do not use setup-build in this package. Source-build packages are separate and include Dockerfile directories.
'@
    }

    $content = $content.Replace("__IMAGE_NAMESPACE__", $ImageNamespace).Replace("__IMAGE_VERSION__", $ImageVersion)
    Set-Utf8NoBomContent -Path $quickstartPath -Content ($content.TrimEnd() + "`n")
}

function New-ZipPackage {
    param(
        [string]$StageDir,
        [string]$Name
    )

    $zipPath = Join-Path $OutputDir "$Name.zip"
    if (Test-Path -LiteralPath $zipPath) {
        $zipPath = Join-Path $OutputDir "$Name-$stamp.zip"
    }

    Add-Type -AssemblyName System.IO.Compression | Out-Null

    $stageFullPath = (Resolve-Path -LiteralPath $StageDir).Path.TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $zipFullPath = [System.IO.Path]::GetFullPath($zipPath)

    $zipFileStream = [System.IO.File]::Open(
        $zipFullPath,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None
    )
    try {
        $archive = [System.IO.Compression.ZipArchive]::new(
            $zipFileStream,
            [System.IO.Compression.ZipArchiveMode]::Create,
            $false
        )
        try {
            Get-ChildItem -LiteralPath $StageDir -Recurse -File | Sort-Object FullName | ForEach-Object {
                $fileFullPath = $_.FullName
                $entryName = $fileFullPath.Substring($stageFullPath.Length).TrimStart("\", "/") -replace "\\", "/"
                if (-not $entryName) {
                    return
                }

                $entry = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
                $entry.LastWriteTime = $_.LastWriteTime
                $entryStream = $entry.Open()
                try {
                    $fileStream = [System.IO.File]::OpenRead($fileFullPath)
                    try {
                        $fileStream.CopyTo($entryStream)
                    }
                    finally {
                        $fileStream.Dispose()
                    }
                }
                finally {
                    $entryStream.Dispose()
                }
            }
        }
        finally {
            $archive.Dispose()
        }
    }
    finally {
        $zipFileStream.Dispose()
    }

    return $zipPath
}

function Has-Dockerfile {
    param([string]$Source)
    return (Test-Path -LiteralPath $Source -PathType Container) -and
        (Test-Path -LiteralPath (Join-Path $Source "Dockerfile") -PathType Leaf)
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

Write-Step "Creating pull-image package"
$pullStage = Join-Path $stagingRoot "pull"
Copy-FilteredTree -Source $RootDir -Destination $pullStage -Root
Remove-PullPackageBuildEntries $pullStage
Set-PackageEnvDefaults $pullStage
Write-Quickstart -PackageRoot $pullStage -PackageType "pull"
$pullZip = New-ZipPackage -StageDir $pullStage -Name "stardew-valley-server-kit-pull-$ImageVersion"
Write-Ok "Created $pullZip"

$missingSource = @()
if (-not (Has-Dockerfile $ServerSource)) {
    $missingSource += "server: $ServerSource"
}
if (-not (Has-Dockerfile $SteamServiceSource)) {
    $missingSource += "steam-service: $SteamServiceSource"
}
if (-not (Has-Dockerfile $DiscordBotSource)) {
    $missingSource += "discord-bot: $DiscordBotSource"
}

if ($missingSource.Count -gt 0) {
    Write-Warn "Skipping source-build package because Docker build contexts are incomplete:"
    foreach ($item in $missingSource) {
        Write-Warn "  $item"
    }
    if ($RequireSourceBuildPackage) {
        throw "Source-build package was required but one or more Dockerfile directories are missing."
    }
    exit 0
}

Write-Step "Creating source-build package"
$sourceStage = Join-Path $stagingRoot "source-build"
Copy-FilteredTree -Source $RootDir -Destination $sourceStage -Root
Copy-FilteredTree -Source $ServerSource -Destination (Join-Path $sourceStage "server")
Copy-FilteredTree -Source $SteamServiceSource -Destination (Join-Path $sourceStage "steam-service")
Copy-FilteredTree -Source $DiscordBotSource -Destination (Join-Path $sourceStage "discord-bot")
Copy-Item -LiteralPath (Join-Path $sourceStage "docker-compose.build.yml.example") -Destination (Join-Path $sourceStage "docker-compose.build.yml")
Set-PackageEnvDefaults $sourceStage
Write-Quickstart -PackageRoot $sourceStage -PackageType "source-build"
$sourceZip = New-ZipPackage -StageDir $sourceStage -Name "stardew-valley-server-kit-source-build-$ImageVersion"
Write-Ok "Created $sourceZip"
