[CmdletBinding()]
param(
    [string]$ImageNamespace,
    [string]$ImageVersion,
    [string]$BuildFile = $env:SVSK_BUILD_COMPOSE_FILE,
    [string]$EnvFile = $env:SVSK_RELEASE_ENV_FILE,
    [switch]$NoPush
)

$ErrorActionPreference = "Stop"

$RootDir = $PSScriptRoot
$BuildComposeExampleFile = Join-Path $RootDir "docker-compose.build.yml.example"
if (-not $BuildFile) {
    $BuildFile = Join-Path $RootDir "docker-compose.build.yml"
}
elseif (-not [System.IO.Path]::IsPathRooted($BuildFile)) {
    $BuildFile = Join-Path $RootDir $BuildFile
}

if (-not $EnvFile) {
    $localEnv = Join-Path $RootDir ".env"
    if (Test-Path -LiteralPath $localEnv) {
        $EnvFile = $localEnv
    }
    else {
        $EnvFile = Join-Path $RootDir ".env.example"
    }
}
elseif (-not [System.IO.Path]::IsPathRooted($EnvFile)) {
    $EnvFile = Join-Path $RootDir $EnvFile
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

function Assert-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Command not found: docker."
    }

    & docker version | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker is not running."
    }
}

function Ensure-BuildComposeFile {
    if (Test-Path -LiteralPath $BuildFile) {
        return
    }

    if (-not (Test-Path -LiteralPath $BuildComposeExampleFile)) {
        throw "Local build compose file not found: $BuildFile"
    }

    Copy-Item -LiteralPath $BuildComposeExampleFile -Destination $BuildFile
    Write-Warn "Created docker-compose.build.yml from docker-compose.build.yml.example."
    Write-Warn "Edit docker-compose.build.yml if your Dockerfile directories are different."
}

function Invoke-ReleaseCompose {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$ComposeArgs
    )

    Push-Location $RootDir
    $oldNamespace = $env:IMAGE_NAMESPACE
    $oldVersion = $env:IMAGE_VERSION
    try {
        $env:IMAGE_NAMESPACE = $ImageNamespace
        $env:IMAGE_VERSION = $ImageVersion

        $argsWithEnv = @(
            "compose", "--env-file", $EnvFile,
            "-f", (Join-Path $RootDir "docker-compose.yml"),
            "-f", $BuildFile,
            "--profile", "discord"
        ) + $ComposeArgs

        & docker @argsWithEnv
        if ($LASTEXITCODE -ne 0) {
            throw "docker $($argsWithEnv -join ' ') failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        $env:IMAGE_NAMESPACE = $oldNamespace
        $env:IMAGE_VERSION = $oldVersion
        Pop-Location
    }
}

function Get-ReleaseComposeConfig {
    Push-Location $RootDir
    $oldNamespace = $env:IMAGE_NAMESPACE
    $oldVersion = $env:IMAGE_VERSION
    try {
        $env:IMAGE_NAMESPACE = $ImageNamespace
        $env:IMAGE_VERSION = $ImageVersion

        $argsWithEnv = @(
            "compose", "--env-file", $EnvFile,
            "-f", (Join-Path $RootDir "docker-compose.yml"),
            "-f", $BuildFile,
            "--profile", "discord",
            "config", "--format", "json"
        )

        $json = & docker @argsWithEnv
        if ($LASTEXITCODE -ne 0) {
            throw "docker $($argsWithEnv -join ' ') failed with exit code $LASTEXITCODE"
        }

        return (($json -join "`n") | ConvertFrom-Json)
    }
    finally {
        $env:IMAGE_NAMESPACE = $oldNamespace
        $env:IMAGE_VERSION = $oldVersion
        Pop-Location
    }
}

function Assert-LocalBuildInputs {
    Ensure-BuildComposeFile
    $config = Get-ReleaseComposeConfig
    $requiredServices = @("server", "steam-auth", "discord-bot")
    $missing = [System.Collections.Generic.List[string]]::new()

    foreach ($serviceName in $requiredServices) {
        $service = $config.services.$serviceName
        if (-not $service) {
            $missing.Add("${serviceName}: service is missing")
            continue
        }

        if (-not $service.build) {
            $missing.Add("${serviceName}: build is missing")
            continue
        }

        $context = [string]$service.build.context
        if (-not $context) {
            $missing.Add("${serviceName}: build.context is missing")
            continue
        }

        $dockerfile = if ($service.build.dockerfile) { [string]$service.build.dockerfile } else { "Dockerfile" }
        $dockerfilePath = if ([System.IO.Path]::IsPathRooted($dockerfile)) {
            $dockerfile
        }
        else {
            Join-Path $context $dockerfile
        }

        if (-not (Test-Path -LiteralPath $context -PathType Container)) {
            $missing.Add("${serviceName}: build context not found: $context")
        }
        elseif (-not (Test-Path -LiteralPath $dockerfilePath -PathType Leaf)) {
            $missing.Add("${serviceName}: Dockerfile not found: $dockerfilePath")
        }
    }

    if ($missing.Count -gt 0) {
        Write-Host "Missing local Docker build inputs:" -ForegroundColor Red
        foreach ($item in $missing) {
            Write-Host " - $item" -ForegroundColor Red
        }
        throw "Fix docker-compose.build.yml or copy the source/Dockerfile directories into this package."
    }
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "Env file not found: $EnvFile"
}

if (-not $ImageNamespace) {
    $ImageNamespace = $env:IMAGE_NAMESPACE
}
if (-not $ImageNamespace) {
    $ImageNamespace = Get-EnvValueFromFile $EnvFile "IMAGE_NAMESPACE"
}
if (-not $ImageNamespace) {
    $ImageNamespace = "sdvd"
}

if (-not $ImageVersion) {
    $ImageVersion = $env:IMAGE_VERSION
}
if (-not $ImageVersion) {
    $ImageVersion = Get-EnvValueFromFile $EnvFile "IMAGE_VERSION"
}
if (-not $ImageVersion) {
    $ImageVersion = "preview"
}

Assert-Docker

Write-Step "Release configuration"
Write-Host "Namespace: $ImageNamespace"
Write-Host "Version:   $ImageVersion"
Write-Host "Env file:  $EnvFile"
Write-Host "Build:     $BuildFile"

Write-Step "Checking local Docker build inputs"
Assert-LocalBuildInputs
Write-Ok "Build inputs ready"

Write-Step "Building Docker images"
Invoke-ReleaseCompose build server steam-auth discord-bot
Write-Ok "Images built"

if ($NoPush) {
    Write-Warn "Skipping docker push because -NoPush was used."
    exit 0
}

Write-Step "Pushing Docker images"
try {
    Invoke-ReleaseCompose push server steam-auth discord-bot
}
catch {
    throw "docker push failed. Run docker login and check IMAGE_NAMESPACE/Image permissions. $($_.Exception.Message)"
}
Write-Ok "Images pushed"
