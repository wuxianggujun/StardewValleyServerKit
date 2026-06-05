[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("doctor", "check-env", "login", "download", "steamcmd-download", "steam-network", "smoke", "setup", "build", "build-setup", "start", "build-start", "stop", "restart", "logs", "status", "update", "build-update", "backup", "join-info", "admin", "admin-public", "admin-token-rotate", "admin-service-install", "admin-service-install-public", "admin-service-start", "admin-service-stop", "admin-service-restart", "admin-service-status", "admin-service-logs", "vnc-url", "vnc-proxy", "vnc-check", "vnc-fix", "vnc-resize", "host-auto", "host-visibility")]
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
$BuildComposeExampleFile = Join-Path $RootDir "docker-compose.build.yml.example"
$BuildComposeFile = if ($env:SVSK_BUILD_COMPOSE_FILE) {
    if ([System.IO.Path]::IsPathRooted($env:SVSK_BUILD_COMPOSE_FILE)) {
        $env:SVSK_BUILD_COMPOSE_FILE
    }
    else {
        Join-Path $RootDir $env:SVSK_BUILD_COMPOSE_FILE
    }
}
else {
    Join-Path $RootDir "docker-compose.build.yml"
}
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

function Get-DockerImageSettings {
    $imageNamespace = "sdvd"
    $imageVersion = "preview"
    if (Test-Path $EnvFile) {
        $configuredNamespace = Get-EnvValue "IMAGE_NAMESPACE"
        if ($configuredNamespace) {
            $imageNamespace = $configuredNamespace
        }
        $configuredVersion = Get-EnvValue "IMAGE_VERSION"
        if ($configuredVersion) {
            $imageVersion = $configuredVersion
        }
    }

    return [pscustomobject]@{
        Namespace = $imageNamespace
        Version = $imageVersion
        Images = @(
            "$imageNamespace/server:$imageVersion",
            "$imageNamespace/steam-service:$imageVersion",
            "$imageNamespace/discord-bot:$imageVersion"
        )
    }
}

function Invoke-DockerForDiagnostics {
    param(
        [string[]]$DockerArgs,
        [switch]$SuppressOutput,
        [int]$TimeoutSeconds = 0
    )

    if ($TimeoutSeconds -gt 0) {
        $job = Start-Job -ScriptBlock {
            param([string[]]$DockerArgs)

            $jobOutputLines = [System.Collections.Generic.List[string]]::new()
            & docker @DockerArgs 2>&1 | ForEach-Object {
                $jobOutputLines.Add([string]$_)
            }

            [pscustomobject]@{
                ExitCode = $LASTEXITCODE
                OutputLines = @($jobOutputLines)
            }
        } -ArgumentList (, $DockerArgs)

        try {
            if (-not (Wait-Job -Job $job -Timeout $TimeoutSeconds)) {
                Stop-Job -Job $job -Force
                return [pscustomobject]@{
                    ExitCode = 124
                    OutputLines = @("Docker command timed out after $TimeoutSeconds seconds: docker $($DockerArgs -join ' ')")
                }
            }

            $jobResult = Receive-Job -Job $job
            return [pscustomobject]@{
                ExitCode = $jobResult.ExitCode
                OutputLines = @($jobResult.OutputLines)
            }
        }
        finally {
            Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
        }
    }

    $outputLines = [System.Collections.Generic.List[string]]::new()
    $oldPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        & docker @DockerArgs 2>&1 | ForEach-Object {
            $line = [string]$_
            $outputLines.Add($line)
            if (-not $SuppressOutput) {
                Write-Host $line
            }
        }
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $oldPreference
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        OutputLines = @($outputLines)
    }
}

function Join-DockerDiagnosticText {
    param([object[]]$OutputLines)

    return (($OutputLines | ForEach-Object { [string]$_ }) -join "`n")
}

function Get-DockerFailureKind {
    param([object[]]$OutputLines)

    $text = (Join-DockerDiagnosticText $OutputLines).ToLowerInvariant()
    if ($text -match 'dockerdesktoplinuxengine|docker_engine|//\./pipe/docker|\\\\\.\\pipe\\docker|cannot connect to the docker daemon|error during connect|daemon is not running') {
        return "engine"
    }

    if ($text -match 'registry-1\.docker\.io|docker\.io|docker hub|registry' -and
        $text -match 'timeout|timed out|i/o timeout|tls handshake timeout|context deadline exceeded|client\.timeout|request canceled|no such host|could not resolve|temporary failure in name resolution|proxyconnect|connection refused|connection reset|network is unreachable|dial tcp') {
        return "registry"
    }

    if ($text -match 'manifest unknown|no matching manifest|pull access denied|repository does not exist|requested access to the resource is denied|insufficient_scope|name unknown|failed to resolve reference|not found') {
        return "image"
    }

    return "unknown"
}

function Get-DockerImageFromText {
    param(
        [object[]]$OutputLines,
        [string[]]$FallbackImages = @()
    )

    $text = Join-DockerDiagnosticText $OutputLines
    if ($text -match '(sdvd/[a-z0-9._/-]+:[a-zA-Z0-9._-]+)') {
        return $Matches[1]
    }

    if ($FallbackImages.Count -gt 0) {
        return ($FallbackImages -join ", ")
    }

    return ""
}

function Write-DockerDiagnostic {
    param(
        [string]$Kind,
        [string]$Operation,
        [object[]]$OutputLines,
        [string[]]$Images = @(),
        [switch]$WarningOnly
    )

    $prefix = if ($WarningOnly) { "WARN" } else { "ERROR" }
    $color = if ($WarningOnly) { "Yellow" } else { "Red" }
    $imageText = Get-DockerImageFromText -OutputLines $OutputLines -FallbackImages $Images

    Write-Host ""
    switch ($Kind) {
        "engine" {
            Write-Host "$prefix Docker Desktop Linux Engine 未运行或当前终端连接不上。" -ForegroundColor $color
            Write-Host "当前步骤：$Operation"
            Write-Host ""
            Write-Host "处理方法："
            Write-Host "1. 打开 Docker Desktop，等待状态显示为 Engine running。"
            Write-Host "2. 确认 Docker Desktop 正在使用 Linux containers。"
            Write-Host "3. 如果刚启动 Docker Desktop，请等待 1 到 2 分钟后重试。"
            Write-Host "4. 仍失败时，在 Docker Desktop 的 Troubleshoot 中执行 Restart。"
            Write-Host ""
            Write-Host "验证命令：docker version"
            Write-Host "建议重试：.\setup.ps1 doctor"
        }
        "registry" {
            Write-Host "$prefix 无法访问 Docker Hub 或镜像仓库。" -ForegroundColor $color
            Write-Host "当前步骤：$Operation"
            if ($imageText) {
                Write-Host "相关镜像：$imageText"
            }
            Write-Host ""
            Write-Host "这通常是网络、代理、DNS 或 Docker Desktop 网络配置问题。"
            Write-Host "setup 会在 Steam 登录或下载前停止，避免继续触发敏感流程。"
            Write-Host ""
            Write-Host "处理方法："
            Write-Host "1. 确认当前网络可以访问 https://registry-1.docker.io/v2/。"
            Write-Host "2. 如果使用代理，在 Docker Desktop 和终端中配置相同代理。"
            Write-Host "3. 公司或校园网络受限时，切换网络或配置 Docker 镜像加速。"
            Write-Host "4. 网络恢复后运行：docker pull sdvd/server:preview"
            Write-Host "5. 不想从仓库拉取时，改用本地构建：.\setup.ps1 build-setup"
        }
        "image" {
            Write-Host "$prefix Docker 镜像标签不可拉取。" -ForegroundColor $color
            Write-Host "当前步骤：$Operation"
            if ($imageText) {
                Write-Host "相关镜像：$imageText"
            }
            Write-Host ""
            Write-Host "常见原因：默认 preview 标签尚未发布、已被移除，或 .env 中 IMAGE_NAMESPACE / IMAGE_VERSION 配置错误。"
            Write-Host ""
            Write-Host "处理方法："
            Write-Host "1. 检查 .env 中的 IMAGE_NAMESPACE 和 IMAGE_VERSION。"
            Write-Host "2. 手动验证标签：docker manifest inspect sdvd/server:preview"
            Write-Host "3. 改成已发布的镜像标签后重试：.\setup.ps1 update"
            Write-Host "4. 如果仓库暂不可用，使用本地构建：.\setup.ps1 build-setup"
        }
        default {
            Write-Host "$prefix Docker 命令执行失败。" -ForegroundColor $color
            Write-Host "当前步骤：$Operation"
            Write-Host ""
            Write-Host "处理方法："
            Write-Host "1. 先运行：.\setup.ps1 doctor"
            Write-Host "2. 再运行：docker version"
            Write-Host "3. 如需进一步排查，可单独运行失败的 docker compose 命令。"
        }
    }
}

function Stop-DockerFailure {
    param(
        [string]$Operation,
        [object[]]$OutputLines,
        [string[]]$Images = @()
    )

    $kind = Get-DockerFailureKind $OutputLines
    Write-DockerDiagnostic -Kind $kind -Operation $Operation -OutputLines $OutputLines -Images $Images
    exit 1
}

function Invoke-ComposeWithDiagnostics {
    param(
        [string]$Operation,
        [string[]]$ComposeArgs,
        [string[]]$Images = @(),
        [string]$ComposeEnvFile = $EnvFile
    )

    Push-Location $RootDir
    try {
        $argsWithEnv = @("compose", "--env-file", $ComposeEnvFile) + $ComposeArgs
        $result = Invoke-DockerForDiagnostics -DockerArgs $argsWithEnv -SuppressOutput
        if ($result.ExitCode -ne 0) {
            Stop-DockerFailure -Operation $Operation -OutputLines $result.OutputLines -Images $Images
        }

        foreach ($line in $result.OutputLines) {
            if ($line) {
                Write-Host $line
            }
        }
    }
    finally {
        Pop-Location
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

function Assert-BuildComposeFile {
    if (-not (Test-Path -LiteralPath $BuildComposeFile)) {
        if (-not (Test-Path -LiteralPath $BuildComposeExampleFile)) {
            throw "Local build compose file not found: $BuildComposeFile. Add docker-compose.build.yml with build.context paths for local builds."
        }

        Copy-Item -LiteralPath $BuildComposeExampleFile -Destination $BuildComposeFile
        Write-Warn "Created docker-compose.build.yml from docker-compose.build.yml.example."
        Write-Warn "If this package does not include .\server and .\steam-service Dockerfiles, edit docker-compose.build.yml before retrying."
    }
}

function Get-BuildComposeConfig {
    Assert-BuildComposeFile

    Push-Location $RootDir
    try {
        $profileArgs = @()
        if ($EnableDiscord) {
            $profileArgs = @("--profile", "discord")
        }

        $argsWithEnv = @(
            "compose", "--env-file", $EnvFile,
            "-f", (Join-Path $RootDir "docker-compose.yml"),
            "-f", $BuildComposeFile
        ) + $profileArgs + @("config", "--format", "json")

        $json = & docker @argsWithEnv
        if ($LASTEXITCODE -ne 0) {
            throw "docker $($argsWithEnv -join ' ') failed with exit code $LASTEXITCODE"
        }

        return (($json -join "`n") | ConvertFrom-Json)
    }
    finally {
        Pop-Location
    }
}

function Assert-LocalBuildInputs {
    $config = Get-BuildComposeConfig
    $missing = [System.Collections.Generic.List[string]]::new()

    foreach ($serviceProperty in $config.services.PSObject.Properties) {
        $serviceName = $serviceProperty.Name
        $service = $serviceProperty.Value
        if (-not $service.build) {
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

function Invoke-BuildCompose {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$ComposeArgs
    )

    Assert-BuildComposeFile
    Push-Location $RootDir
    try {
        $argsWithEnv = @("compose", "--env-file", $EnvFile, "-f", (Join-Path $RootDir "docker-compose.yml"), "-f", $BuildComposeFile) + $ComposeArgs
        & docker @argsWithEnv
        if ($LASTEXITCODE -ne 0) {
            throw "docker $($argsWithEnv -join ' ') failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

function Show-SteamCmdFallbackHint {
    Write-Warn "steam-auth uses the SteamClient/SteamKit login path; SteamCMD uses Valve's official console client path."
    Write-Warn "Docker registry mirrors only fix Docker image pulls; they do not fix SteamClient or SteamCMD connectivity."
    Write-Warn "If SteamCMD asks for a Steam Guard code, type the newest code into this terminal and press Enter."
    Write-Warn "Do not paste Steam passwords, Steam Guard codes, or tokens into chat, issues, or screenshots."
}

function Get-SteamNetworkProbeUrl {
    return "https://api.steampowered.com/ISteamDirectory/GetCMList/v1/?cellid=0&format=json"
}

function Get-SteamProxyValue {
    param(
        [string]$Key,
        [string]$FallbackKey = ""
    )

    $value = Get-ExternalEnvValue @($Key)
    if (-not $value) {
        $value = Get-EnvValue $Key
    }

    if (-not $value -and $FallbackKey) {
        $value = Get-ExternalEnvValue @($FallbackKey)
        if (-not $value) {
            $value = Get-EnvValue $FallbackKey
        }
    }

    return $value
}

function Test-SteamProxyConfigured {
    foreach ($key in @("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy")) {
        if (Get-SteamProxyValue $key) {
            return $true
        }
    }

    return $false
}

function Get-SteamProxyDockerArgs {
    $args = [System.Collections.Generic.List[string]]::new()

    foreach ($key in @("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY")) {
        $value = Get-SteamProxyValue $key
        if ($value) {
            $args.Add("-e")
            $args.Add("${key}=$value")
        }
    }

    $proxyMap = @(
        @{ Key = "http_proxy"; Fallback = "HTTP_PROXY" },
        @{ Key = "https_proxy"; Fallback = "HTTPS_PROXY" },
        @{ Key = "all_proxy"; Fallback = "ALL_PROXY" },
        @{ Key = "no_proxy"; Fallback = "NO_PROXY" }
    )

    foreach ($item in $proxyMap) {
        $value = Get-SteamProxyValue $item.Key $item.Fallback
        if ($value) {
            $args.Add("-e")
            $args.Add("$($item.Key)=$value")
        }
    }

    return @($args)
}

function Show-SteamNetworkHelp {
    Write-Warn "Steam Directory API is not reachable from this host. SteamClient may fail before Steam Guard."
    Write-Warn "This is a Steam network path issue, not a Steam username spelling issue."
    Write-Warn "Docker Hub mirror settings do not affect api.steampowered.com or Steam CM servers."
    Write-Warn "If this server cannot reach Steam directly, set HTTP_PROXY/HTTPS_PROXY/ALL_PROXY in .env and retry."
}

function Get-SteamNetworkCheckRetries {
    $value = Get-ExternalEnvValue @("STEAM_NETWORK_CHECK_RETRIES")
    if (-not $value) {
        $value = Get-EnvValue "STEAM_NETWORK_CHECK_RETRIES"
    }

    $parsed = 0
    if ([int]::TryParse($value, [ref]$parsed) -and $parsed -gt 0) {
        return $parsed
    }

    return 3
}

function Test-SteamNetworkConnectivity {
    Write-Step "Checking Steam Directory API"
    $retries = Get-SteamNetworkCheckRetries
    for ($attempt = 1; $attempt -le $retries; $attempt++) {
        $request = $null
        $response = $null
        try {
            $request = [System.Net.WebRequest]::Create((Get-SteamNetworkProbeUrl))
            $request.Timeout = 15000
            $request.ReadWriteTimeout = 15000
            $response = $request.GetResponse()
            Write-Ok "Steam Directory API reachable"
            return $true
        }
        catch {
            Write-Warn "Steam Directory API probe failed on attempt ${attempt}/${retries}: $($_.Exception.Message)"
        }
        finally {
            if ($response) {
                $response.Close()
            }
        }

        if ($attempt -lt $retries) {
            Start-Sleep -Seconds 3
        }
    }

    Show-SteamNetworkHelp
    return $false
}

function Test-SteamHttpEndpoint {
    param(
        [string]$Url,
        [string]$Label
    )

    Write-Host "-- $Label"
    $request = $null
    $response = $null
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $request = [System.Net.WebRequest]::Create($Url)
        $request.Timeout = 15000
        $request.ReadWriteTimeout = 15000
        $request.UserAgent = "StardewValleyServerKit/steam-network"
        $response = $request.GetResponse()
        $timer.Stop()
        $statusCode = 200
        if ($response.PSObject.Properties.Name -contains "StatusCode") {
            $statusCode = [int]$response.StatusCode
        }
        Write-Host ("http={0} total={1:n3}s" -f $statusCode, $timer.Elapsed.TotalSeconds)
        Write-Ok "$Label reachable over HTTPS"
        return $true
    }
    catch {
        $timer.Stop()
        Write-Host ("http=000 total={0:n3}s err={1}" -f $timer.Elapsed.TotalSeconds, $_.Exception.Message)
        Write-Warn "$Label HTTPS probe failed"
        return $false
    }
    finally {
        if ($response) {
            $response.Close()
        }
    }
}

function Invoke-DockerForSteamNetwork {
    param(
        [string[]]$DockerArgs,
        [int]$TimeoutSeconds = 240
    )

    $job = Start-Job -ScriptBlock {
        param([string[]]$DockerArgs)

        $jobOutputLines = [System.Collections.Generic.List[string]]::new()
        & docker @DockerArgs 2>&1 | ForEach-Object {
            $jobOutputLines.Add([string]$_)
        }

        [pscustomobject]@{
            ExitCode = $LASTEXITCODE
            OutputLines = @($jobOutputLines)
        }
    } -ArgumentList (, $DockerArgs)

    try {
        if (-not (Wait-Job -Job $job -Timeout $TimeoutSeconds)) {
            Stop-Job -Job $job -Force
            return [pscustomobject]@{
                ExitCode = 124
                OutputLines = @("Docker command timed out after $TimeoutSeconds seconds.")
            }
        }

        $jobResult = Receive-Job -Job $job
        return [pscustomobject]@{
            ExitCode = $jobResult.ExitCode
            OutputLines = @($jobResult.OutputLines)
        }
    }
    finally {
        Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    }
}

function Ensure-DockerHelperImage {
    param([string]$Image)

    $localResult = Invoke-DockerForDiagnostics -DockerArgs @("image", "inspect", $Image) -SuppressOutput
    if ($localResult.ExitCode -eq 0) {
        return
    }

    Write-Step "Pulling Docker helper image: $Image"
    $pullResult = Invoke-DockerForDiagnostics -DockerArgs @("pull", $Image) -SuppressOutput -TimeoutSeconds 300
    if ($pullResult.ExitCode -ne 0) {
        Stop-DockerFailure -Operation "Pulling Docker helper image $Image" -OutputLines $pullResult.OutputLines -Images @($Image)
    }
}

function Invoke-SteamCmdAnonymousNetworkProbe {
    $image = "cm2network/steamcmd:latest"
    $steamCmdProbeVolume = "stardew-valley-server-kit_steamcmd-net-test"
    $timeoutSeconds = 240
    $configuredTimeout = Get-ExternalEnvValue @("SVSK_STEAMCMD_NETWORK_TEST_TIMEOUT")
    if ($configuredTimeout) {
        $parsedTimeout = 0
        if ([int]::TryParse($configuredTimeout, [ref]$parsedTimeout) -and $parsedTimeout -gt 0) {
            $timeoutSeconds = $parsedTimeout
        }
    }

    Write-Step "Checking SteamCMD anonymous login"
    Write-Warn "This uses anonymous login only. It does not read Steam credentials from .env."
    $steamProxyArgs = Get-SteamProxyDockerArgs
    if (Test-SteamProxyConfigured) {
        Write-Ok "Steam proxy variables are configured; values are not printed"
    }

    Ensure-DockerHelperImage $image

    $prepareArgs = @(
        "run", "--rm", "--user", "0:0",
        "-v", "${steamCmdProbeVolume}:/home/steam/Steam",
        "--entrypoint", "bash",
        $image,
        "-lc", "mkdir -p /home/steam/Steam && chown -R steam:steam /home/steam/Steam"
    )
    $prepareResult = Invoke-DockerForDiagnostics -DockerArgs $prepareArgs -SuppressOutput -TimeoutSeconds 60
    if ($prepareResult.ExitCode -ne 0) {
        Stop-DockerFailure -Operation "Preparing SteamCMD network test volume" -OutputLines $prepareResult.OutputLines -Images @($image)
    }

    $dockerArgs = @("run", "--rm") +
        $steamProxyArgs +
        @(
            "-v", "${steamCmdProbeVolume}:/home/steam/Steam",
            $image,
            "bash", "-lc", "/home/steam/steamcmd/steamcmd.sh +login anonymous +quit"
        )

    $result = Invoke-DockerForSteamNetwork -DockerArgs $dockerArgs -TimeoutSeconds $timeoutSeconds
    foreach ($line in $result.OutputLines) {
        if ($line) {
            Write-Host (Protect-LogLine ([string]$line))
        }
    }

    $text = ($result.OutputLines -join "`n")
    if ($result.ExitCode -eq 0 -and $text -match "Connecting anonymously to Steam Public|Waiting for user info") {
        Write-Ok "SteamCMD anonymous login reached Steam Public"
        return $true
    }

    if ($result.ExitCode -eq 124) {
        Write-Warn "SteamCMD anonymous login timed out after ${timeoutSeconds}s"
    }
    else {
        Write-Warn "SteamCMD anonymous login failed with exit code $($result.ExitCode)"
    }
    Write-Warn "If this fails while Docker image pulls work, the server needs a Steam-capable network path or proxy."
    return $false
}

function Invoke-SteamNetworkDiagnostics {
    $failed = $false

    Write-Step "Checking Steam DNS"
    foreach ($hostName in @("api.steampowered.com", "store.steampowered.com", "steamcommunity.com", "cm0.steampowered.com", "cm1.steampowered.com", "steamcdn-a.akamaihd.net")) {
        Write-Host "-- $hostName"
        try {
            [System.Net.Dns]::GetHostAddresses($hostName) |
                Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork } |
                Select-Object -First 8 |
                ForEach-Object { Write-Host $_.IPAddressToString }
        }
        catch {
            Write-Warn "DNS lookup failed for ${hostName}: $($_.Exception.Message)"
            $failed = $true
        }
    }

    Write-Step "Checking Steam HTTPS endpoints"
    if (-not (Test-SteamHttpEndpoint "https://store.steampowered.com/" "Steam Store")) { $failed = $true }
    if (-not (Test-SteamHttpEndpoint "https://steamcommunity.com/" "Steam Community")) { $failed = $true }
    if (-not (Test-SteamHttpEndpoint (Get-SteamNetworkProbeUrl) "Steam Directory API")) { $failed = $true }

    Write-Step "Checking Steam CM TCP endpoints"
    foreach ($hostName in @("cm0.steampowered.com", "cm1.steampowered.com", "162.254.193.6", "162.254.195.44")) {
        foreach ($port in @(443, 27017, 27018, 27019, 27020)) {
            $ok = Test-TcpPort -HostName $hostName -Port $port -TimeoutMs 6000
            Write-Host ("{0}:{1} {2}" -f $hostName, $port, $(if ($ok) { "ok" } else { "fail" }))
            if (-not $ok) {
                $failed = $true
            }
        }
    }

    if (-not (Invoke-SteamCmdAnonymousNetworkProbe)) {
        $failed = $true
    }

    if (-not $failed) {
        Write-Ok "Steam public network diagnostics passed"
        return
    }

    Write-Warn "Steam public network diagnostics found at least one blocked or unstable endpoint."
    Write-Warn "If SteamCMD anonymous login succeeds but steam-auth still fails, use steamcmd-download from an SSH TTY for Steam Guard."
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
    param(
        [string]$Line,
        [string[]]$ExtraSecrets = @()
    )

    $protected = $Line -replace '\x1B\[[0-9;?]*[ -/]*[@-~]', ''
    foreach ($key in @("STEAM_USERNAME", "STEAM_PASSWORD", "STEAM_REFRESH_TOKEN", "VNC_PASSWORD", "API_KEY", "ADMIN_TOKEN", "SERVER_PASSWORD", "DISCORD_BOT_TOKEN", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY")) {
        $value = Get-EnvValue $key
        if ($value) {
            $protected = $protected.Replace($value, "<redacted>")
        }
    }
    foreach ($value in $ExtraSecrets) {
        if ($value) {
            $protected = $protected.Replace($value, "<redacted>")
        }
    }

    return $protected
}

function Test-InteractiveTerminal {
    return ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected)
}

function Test-SteamCmdOutputRequiresInteractiveGuard {
    param([string]$Text)
    return ($Text -match "Steam Guard code|This computer has not been authenticated|set_steam_guard_code")
}

function Read-SteamGuardCode {
    Write-Warn "SteamCMD requested Steam Guard verification."
    Write-Warn "Enter the newest code from email or Steam Mobile. Input is hidden and will not be saved or printed."
    $code = ConvertTo-PlainText (Read-Host "Steam Guard code" -AsSecureString)
    $code = ($code -replace "`r", "").Trim()
    if (-not $code) {
        Write-ErrorExit "Steam Guard code was not entered."
    }

    return $code
}

function Invoke-SteamCmdDockerRun {
    param(
        [string[]]$DockerArgs,
        [string]$LogFile,
        [string[]]$ExtraSecrets = @(),
        [AllowNull()]
        [string]$StandardInput = $null
    )

    $oldPreference = $ErrorActionPreference
    $exitCode = 1
    try {
        $ErrorActionPreference = "Continue"
        if ($null -ne $StandardInput) {
            $StandardInput | & docker @DockerArgs 2>&1 | ForEach-Object {
                    $line = Protect-LogLine -Line ([string]$_) -ExtraSecrets $ExtraSecrets
                    Add-Content -LiteralPath $LogFile -Value $line -Encoding utf8
                    Write-Host $line
                }
        }
        else {
            & docker @DockerArgs 2>&1 | ForEach-Object {
                    $line = Protect-LogLine -Line ([string]$_) -ExtraSecrets $ExtraSecrets
                    Add-Content -LiteralPath $LogFile -Value $line -Encoding utf8
                    Write-Host $line
                }
        }
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $oldPreference
    }

    return $exitCode
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

function Test-UdpPort {
    param(
        [string]$HostName,
        [int]$Port
    )

    $udp = [System.Net.Sockets.UdpClient]::new()
    try {
        $bytes = [System.Text.Encoding]::ASCII.GetBytes("sdv-port-probe")
        [void]$udp.Send($bytes, $bytes.Length, $HostName, $Port)
        return $true
    }
    catch {
        return $false
    }
    finally {
        $udp.Close()
    }
}

function Get-LanIPv4Addresses {
    if (-not (Get-Command Get-NetIPConfiguration -ErrorAction SilentlyContinue)) {
        return @()
    }

    return @(Get-NetIPConfiguration |
        Where-Object { $_.IPv4Address -and $_.NetAdapter.Status -eq "Up" } |
        ForEach-Object {
            foreach ($address in $_.IPv4Address) {
                $ip = $address.IPAddress
                if ($ip -and $ip -ne "127.0.0.1" -and $ip -notlike "169.254.*") {
                    [pscustomobject]@{
                        Interface = $_.InterfaceAlias
                        IPAddress = $ip
                    }
                }
            }
        })
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

function Show-AccessInfo {
    if (-not (Test-Path $EnvFile)) {
        Write-Warn ".env does not exist. Showing default local access URLs."
    }

    $adminHost = Get-EnvOrDefault "ADMIN_HOST" "127.0.0.1"
    $adminPort = Get-EnvOrDefault "ADMIN_PORT" "8088"
    $vncPort = Get-EnvOrDefault "VNC_PORT" "5800"
    $apiPort = Get-EnvOrDefault "API_PORT" "8080"
    $gamePort = Get-EnvOrDefault "GAME_PORT" "24642"
    $queryPort = Get-EnvOrDefault "QUERY_PORT" "27015"

    Write-Step "Access URLs"
    if ($adminHost -eq "0.0.0.0") {
        Write-Host "Admin panel (local): http://127.0.0.1:$adminPort"
        Write-Host "Admin panel (public): http://<server-public-ip>:$adminPort"
    }
    else {
        Write-Host "Admin panel: http://${adminHost}:$adminPort"
    }
    Write-Host "noVNC:       http://127.0.0.1:$vncPort"
    Write-Host "HTTP API:    http://127.0.0.1:$apiPort"
    Write-Host "Game IP:     127.0.0.1"
    Write-Host "Game UDP:    $gamePort"
    Write-Host "Query UDP:   $queryPort"
    Write-Host "Admin command: .\setup.ps1 admin"

    $lanAddresses = Get-LanIPv4Addresses
    if ($lanAddresses.Count -gt 0) {
        Write-Step "LAN IPv4 candidates"
        foreach ($item in $lanAddresses) {
            Write-Host "$($item.IPAddress)  ($($item.Interface))"
        }
        Write-Warn "Players on another LAN device should use the real WLAN/Ethernet IPv4 address."
    }
    else {
        Write-Warn "No LAN IPv4 address found from Windows network adapters."
    }

    if ($adminHost -eq "0.0.0.0") {
        Write-Warn "ADMIN_HOST=0.0.0.0 listens on all interfaces. Restrict TCP access with firewall rules."
    }
    Write-Warn "VNC passwords, API keys, and admin tokens are stored in .env and are not printed here."
}

function Prompt-AdminPanelAfterSetup {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Warn "Node.js was not found. Install Node.js, then run '.\setup.ps1 admin' to start the web admin panel."
        return
    }

    if (-not [Environment]::UserInteractive -or [Console]::IsInputRedirected) {
        Write-Warn "Run '.\setup.ps1 admin' later if you want to open the local web admin panel."
        return
    }

    Write-Step "Optional web admin panel"
    Write-Host "Start the local web admin panel now? This keeps this terminal open. [y/N]: " -NoNewline
    $answer = Read-Host
    if ($answer -match '^(y|yes)$') {
        Invoke-AdminPanel
    }
    else {
        Write-Ok "Skipped admin panel. Run '.\setup.ps1 admin' later when needed."
    }
}

function Show-JoinInfo {
    if (-not (Test-Path $EnvFile)) {
        Write-Warn ".env does not exist. Showing default ports; run setup before starting the real server."
    }

    $gamePort = [int](Get-EnvOrDefault "GAME_PORT" "24642")
    $queryPort = [int](Get-EnvOrDefault "QUERY_PORT" "27015")
    $serverRunning = $false
    $inspectOutput = & docker inspect -f "{{.State.Running}}" sdv-server 2>$null
    if ($LASTEXITCODE -eq 0 -and $inspectOutput -eq "true") {
        $serverRunning = $true
    }

    Write-Step "Player join targets"
    Write-Host "Same Windows PC: 127.0.0.1"
    Write-Host "Game UDP port: $gamePort"
    Write-Host "Query UDP port: $queryPort"
    Write-Host "In Stardew Valley, use Co-op -> Join LAN Game / Enter IP. Do not paste an invite code into the IP field."

    $lanAddresses = Get-LanIPv4Addresses
    if ($lanAddresses.Count -gt 0) {
        Write-Step "LAN IPv4 candidates"
        foreach ($item in $lanAddresses) {
            Write-Host "$($item.IPAddress)  ($($item.Interface))"
        }
        Write-Warn "For another device on the same Wi-Fi/LAN, use the real network adapter IP, usually WLAN or Ethernet."
        Write-Warn "Do not use VMware, VirtualBox, WSL, Hyper-V, or Docker adapter addresses for normal players."
    }
    else {
        Write-Warn "No LAN IPv4 address found from Windows network adapters."
    }

    Write-Step "Docker published ports"
    & docker port sdv-server 2>$null | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "sdv-server container was not found. Start the server before checking published ports."
    }

    Write-Step "Local UDP probe"
    if (Test-UdpPort "127.0.0.1" $gamePort) {
        Write-Ok "Sent UDP probe to 127.0.0.1:$gamePort"
    }
    else {
        Write-Warn "Could not send UDP probe to 127.0.0.1:$gamePort"
    }
    Write-Warn "UDP is connectionless; this proves Windows can send the packet, not that Stardew accepted the game protocol."

    if ($serverRunning) {
        Write-Step "Runtime server signals"
        & docker exec sdv-server sh -lc "printf 'invite_code='; cat /tmp/invite-code.txt 2>/dev/null || printf 'n/a'; printf '\n'; ss -lunp 2>/dev/null | grep -E '(:24642|:27015)' || true; tail -n 120 /tmp/server-output.log 2>/dev/null | grep -E 'IP connections enabled|Invite code|Connected to game session|Network:|Healthcheck' | tail -n 20 || true" 2>&1 |
            ForEach-Object { Protect-LogLine ([string]$_) } |
            Where-Object { $_ -and $_ -notmatch "Connected to the docker container shell|Exit and run 'make cli'" }
    }
    else {
        Write-Warn "sdv-server is not running. Start it before reading invite code and runtime logs."
    }

    Write-Step "What to try next"
    Write-Host "1. If the game client runs on this same Windows PC, enter 127.0.0.1."
    Write-Host "2. If the game client runs on another LAN device, enter the WLAN/Ethernet IPv4 shown above."
    Write-Host "3. If LAN IP still fails, run '.\setup.ps1 logs' while joining and check whether a connection attempt appears."
    Write-Host "4. Invite codes use Steam/Galaxy P2P and can fail independently from IP direct connect."
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
    Invoke-ComposeUpWithDiagnostics -UpArgs @("up", "--detach")

    Write-Step "Waiting for containers"
    Start-Sleep -Seconds 15
    Invoke-ComposeWithDiagnostics -Operation "Showing container status" -ComposeArgs @("ps")

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
    Show-AccessInfo
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

function Invoke-AdminPanel {
    param([switch]$Public)

    Assert-Command "node"

    $adminScript = Join-Path $PSScriptRoot "admin-panel.js"
    if (-not (Test-Path $adminScript)) {
        Write-ErrorExit "Admin panel script not found: $adminScript"
    }

    if ($Public) {
        Set-EnvValue "ADMIN_HOST" "0.0.0.0"
        Set-EnvValue "ADMIN_ALLOW_PUBLIC_HTTP" "true"
        Write-Warn "ADMIN_HOST has been set to 0.0.0.0 for server access."
        Write-Warn "ADMIN_ALLOW_PUBLIC_HTTP=true was enabled for direct private-network access."
    }

    $adminHost = Get-EnvOrDefault "ADMIN_HOST" "127.0.0.1"
    $adminPort = Get-EnvOrDefault "ADMIN_PORT" "8088"

    Write-Step "Starting admin panel"
    if ($adminHost -eq "0.0.0.0") {
        Write-Host "Open (local): http://127.0.0.1:$adminPort"
        Write-Host "Open (public): http://<server-public-ip>:$adminPort"
        Write-Warn "Allow TCP $adminPort in both 1Panel firewall and cloud security group."
        Write-Warn "Restrict TCP $adminPort to your own public IP whenever possible."
        Write-Warn "Prefer HTTPS reverse proxy with ADMIN_HOST=127.0.0.1 for public access."
    }
    else {
        Write-Host "Open: http://${adminHost}:$adminPort"
    }
    Write-Warn "Keep this terminal open while using the admin panel."
    Write-Warn "ADMIN_TOKEN is stored in .env and is not printed to logs."
    & node $adminScript
}

function Invoke-AdminTokenRotate {
    Ensure-AdminEnvFile

    $token = New-Secret 32
    Set-EnvValue "ADMIN_TOKEN" $token

    Write-Step "Rotated admin token"
    Write-Ok "ADMIN_TOKEN has been updated in .env and is not printed to logs."
    Write-Warn "Existing browser sessions must log in again."
}

function Invoke-AdminSystemdUnsupported {
    Write-ErrorExit "Admin systemd service commands are only supported by scripts/sdv-server.sh on Linux. On Windows, use '.\setup.ps1 admin' for a foreground panel."
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
    $dockerArgs = @("run", "--rm") +
        (Get-SteamProxyDockerArgs) +
        @(
            "-v", "${GameVolume}:/data/game",
            "-v", "${SteamCmdVolume}:/home/steam/Steam",
            $Image,
            "bash", "-lc", $sdkCommand
        )

    & docker @dockerArgs 2>&1 | ForEach-Object {
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
    [void](Test-SteamNetworkConnectivity)
    $steamProxyArgs = Get-SteamProxyDockerArgs
    if (Test-SteamProxyConfigured) {
        Write-Ok "Steam proxy variables are configured; values are not printed"
    }
    Write-Warn "If Steam Guard is requested, the script will ask for the code with hidden input."
    Write-Warn "Do not paste Steam passwords, Steam Guard codes, or tokens into chat, issues, or screenshots."
    Initialize-SteamCmdVolumes $image $gameVolume $steamCmdVolume

    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        Write-Step "SteamCMD attempt $attempt of $maxAttempts"
        $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $logFile = Join-Path $LogDir "steamcmd-download-$timestamp-attempt-$attempt.log"
        $oldSteamUsername = $env:STEAM_USERNAME
        $oldSteamPassword = $env:STEAM_PASSWORD
        $exitCode = 1
        try {
            $env:STEAM_USERNAME = $steamUser
            $env:STEAM_PASSWORD = $steamPass
            $dockerArgs = @("run", "--rm") +
                $steamProxyArgs +
                @(
                    "-v", "${gameVolume}:/data/game",
                    "-v", "${steamCmdVolume}:/home/steam/Steam",
                    "-e", "STEAM_USERNAME",
                    "-e", "STEAM_PASSWORD",
                    $image,
                    "bash", "-lc", $downloadCommand
                )

            $exitCode = Invoke-SteamCmdDockerRun -DockerArgs $dockerArgs -LogFile $logFile
        }
        finally {
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

        $logText = ""
        if (Test-Path -LiteralPath $logFile) {
            $logText = Get-Content -LiteralPath $logFile -Raw
        }
        if (Test-SteamCmdOutputRequiresInteractiveGuard $logText) {
            if (-not (Test-InteractiveTerminal)) {
                Write-ErrorExit "SteamCMD requires Steam Guard, but this terminal is non-interactive. Rerun from a terminal with TTY, for example: ssh -t root@server `"cd /opt/stardew-valley-server-kit && ./setup.sh steamcmd-download`""
            }

            $guardCode = Read-SteamGuardCode
            $guardLogFile = Join-Path $LogDir "steamcmd-download-$timestamp-attempt-$attempt-guard.log"
            $oldSteamUsername = $env:STEAM_USERNAME
            $oldSteamPassword = $env:STEAM_PASSWORD
            try {
                $env:STEAM_USERNAME = $steamUser
                $env:STEAM_PASSWORD = $steamPass
                $guardDockerArgs = @("run", "--rm", "-i") +
                    $steamProxyArgs +
                    @(
                        "-v", "${gameVolume}:/data/game",
                        "-v", "${steamCmdVolume}:/home/steam/Steam",
                        "-e", "STEAM_USERNAME",
                        "-e", "STEAM_PASSWORD",
                        $image,
                        "bash", "-lc", $downloadCommand
                    )

                Write-Step "SteamCMD Steam Guard retry"
                $exitCode = Invoke-SteamCmdDockerRun -DockerArgs $guardDockerArgs -LogFile $guardLogFile -ExtraSecrets @($guardCode) -StandardInput $guardCode
            }
            finally {
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
                $guardCode = $null
            }

            if ($exitCode -eq 0) {
                Assert-GameDataInstalled $gameVolume $steamCmdVolume
                Install-SteamworksSdk $image $gameVolume $steamCmdVolume
                Write-Ok "SteamCMD download completed"
                Write-Ok "Log written: logs\$(Split-Path -Leaf $guardLogFile)"
                return
            }

            $logFile = $guardLogFile
            $logText = ""
            if (Test-Path -LiteralPath $logFile) {
                $logText = Get-Content -LiteralPath $logFile -Raw
            }
            if (Test-SteamCmdOutputRequiresInteractiveGuard $logText) {
                Write-Warn "Steam Guard verification did not complete. The code may be expired or incorrect."
            }
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

function Invoke-SteamAuthLogin {
    [void](Test-SteamNetworkConnectivity)
    try {
        if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
            Invoke-Compose run --rm -it steam-auth login
        }
        else {
            Write-Warn "No interactive terminal detected; steam-auth login will run without TTY."
            Write-Warn "Automatically selecting username/password authentication for non-interactive runs."
            Write-Warn "If Steam Guard is requested, rerun this command from a terminal with TTY."
            Push-Location $RootDir
            try {
                "1" | & docker compose --env-file $EnvFile run --rm -T steam-auth login
                if ($LASTEXITCODE -ne 0) {
                    throw "docker compose steam-auth login failed with exit code $LASTEXITCODE"
                }
            }
            finally {
                Pop-Location
            }
        }
    }
    catch {
        Write-Warn "steam-auth login failed. If the log says 'The SteamClient instance must be connected', this is usually not a password error."
        Show-SteamCmdFallbackHint
        throw
    }
}

function Invoke-SteamAuthDownloadOrFallback {
    [void](Test-SteamNetworkConnectivity)
    try {
        Invoke-Compose run --rm steam-auth download
    }
    catch {
        Write-Warn "steam-auth download failed. Falling back to SteamCMD."
        Show-SteamCmdFallbackHint
        Invoke-SteamCmdDownload
    }
}

function Ensure-EnvFile {
    Ensure-AdminEnvFile

    Import-SteamEnvIfAvailable

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
}

function Ensure-AdminEnvFile {
    if (-not (Test-Path $EnvFile)) {
        Copy-Item -LiteralPath $EnvExampleFile -Destination $EnvFile
        Write-Ok "Created .env from .env.example"
    }

    if (-not (Get-EnvValue "VNC_PASSWORD")) {
        Set-EnvValue "VNC_PASSWORD" (New-Secret 18)
    }

    if (-not (Get-EnvValue "API_KEY")) {
        Set-EnvValue "API_KEY" (New-Secret 32)
    }

    if (-not (Get-EnvValue "ADMIN_TOKEN")) {
        Set-EnvValue "ADMIN_TOKEN" (New-Secret 32)
    }

    New-Item -ItemType Directory -Force -Path (Join-Path $RootDir "data\settings"), (Join-Path $RootDir "data\mods") | Out-Null
    Initialize-ServerSettings
}

function Initialize-ServerSettings {
    $settingsPath = Join-Path $RootDir "data\settings\server-settings.json"
    if (Test-Path $settingsPath) {
        return
    }

    @'
{
  "Game": {
    "FarmName": "Junimo",
    "FarmType": 0,
    "ProfitMargin": 1.0,
    "StartingCabins": 1,
    "SpawnMonstersAtNight": "auto"
  },
  "Server": {
    "MaxPlayers": 10,
    "CabinStrategy": "CabinStack",
    "SeparateWallets": false,
    "ExistingCabinBehavior": "KeepExisting",
    "VerboseLogging": false,
    "AllowIpConnections": true,
    "LobbyMode": "Shared",
    "ActiveLobbyLayout": "default",
    "AdminSteamIds": []
  }
}
'@ | Set-Content -LiteralPath $settingsPath -Encoding UTF8
    Write-Ok "Created data/settings/server-settings.json with IP connections enabled"
}

function Assert-Docker {
    Assert-Command "docker"
    $result = Invoke-DockerForDiagnostics -DockerArgs @("version") -SuppressOutput
    if ($result.ExitCode -ne 0) {
        Stop-DockerFailure -Operation "Checking Docker" -OutputLines $result.OutputLines
    }
}

function Assert-ComposeConfig {
    param([string]$ComposeEnvFile)

    Push-Location $RootDir
    try {
        $result = Invoke-DockerForDiagnostics -DockerArgs @("compose", "--env-file", $ComposeEnvFile, "config", "--quiet") -SuppressOutput
        if ($result.ExitCode -ne 0) {
            Stop-DockerFailure -Operation "Validating docker-compose.yml" -OutputLines $result.OutputLines
        }
    }
    finally {
        Pop-Location
    }
}

function Test-DockerImage {
    param([string]$Image)

    $localResult = Invoke-DockerForDiagnostics -DockerArgs @("image", "inspect", $Image) -SuppressOutput
    if ($localResult.ExitCode -eq 0) {
        Write-Ok "Image available: $Image"
        return
    }

    Write-Warn "Image not found locally: $Image"
    $remoteResult = Invoke-DockerForDiagnostics -DockerArgs @("manifest", "inspect", $Image) -SuppressOutput -TimeoutSeconds 20
    if ($remoteResult.ExitCode -eq 0) {
        Write-Ok "Remote image tag available: $Image"
        Write-Host "     Run: docker pull $Image"
        return
    }

    $kind = Get-DockerFailureKind $remoteResult.OutputLines
    Write-DockerDiagnostic -Kind $kind -Operation "Checking remote image $Image" -OutputLines $remoteResult.OutputLines -Images @($Image) -WarningOnly
}

function Invoke-ComposePullWithDiagnostics {
    $imageSettings = Get-DockerImageSettings
    Invoke-ComposeWithDiagnostics -Operation "Pulling Docker images" -ComposeArgs @("pull") -Images $imageSettings.Images
}

function Invoke-ComposeUpWithDiagnostics {
    param([string[]]$UpArgs)

    $imageSettings = Get-DockerImageSettings
    Invoke-ComposeWithDiagnostics -Operation "Starting server" -ComposeArgs $UpArgs -Images $imageSettings.Images
}

function Get-UpArgs {
    if ($EnableDiscord) {
        return @("--profile", "discord", "up", "-d")
    }

    return @("up", "-d")
}

function Invoke-LocalImageBuild {
    Assert-LocalBuildInputs

    $services = @("server", "steam-auth")
    if ($EnableDiscord) {
        $services += "discord-bot"
    }

    Invoke-BuildCompose build @services
}

$dockerRequiredActions = @(
    "doctor", "check-env", "login", "download", "steamcmd-download", "steam-network", "smoke", "setup",
    "build", "build-setup", "start", "build-start", "stop", "restart", "logs", "status",
    "update", "build-update", "backup", "join-info",
    "vnc-url", "vnc-proxy", "vnc-check", "vnc-fix", "vnc-resize", "host-auto", "host-visibility"
)

if ($dockerRequiredActions -contains $Action) {
    Write-Step "Checking Docker"
    Assert-Docker
}

switch ($Action) {
    "doctor" {
        Write-Step "Checking Docker Compose"
        $composeVersion = Invoke-DockerForDiagnostics -DockerArgs @("compose", "version") -SuppressOutput
        if ($composeVersion.ExitCode -ne 0) {
            Stop-DockerFailure -Operation "Checking Docker Compose" -OutputLines $composeVersion.OutputLines
        }
        foreach ($line in $composeVersion.OutputLines) {
            if ($line) {
                Write-Host $line
            }
        }
        Write-Ok "Docker Compose available"

        Write-Step "Validating docker-compose.yml"
        Assert-ComposeConfig $EnvExampleFile
        Write-Ok "Compose config OK"

        Write-Step "Checking Docker images"
        $imageNamespace = "sdvd"
        $imageVersion = "preview"
        if (Test-Path $EnvFile) {
            $configuredNamespace = Get-EnvValue "IMAGE_NAMESPACE"
            if ($configuredNamespace) {
                $imageNamespace = $configuredNamespace
            }
            $configuredVersion = Get-EnvValue "IMAGE_VERSION"
            if ($configuredVersion) {
                $imageVersion = $configuredVersion
            }
        }
        Test-DockerImage "$imageNamespace/server:$imageVersion"
        Test-DockerImage "$imageNamespace/steam-service:$imageVersion"
        Test-DockerImage "$imageNamespace/discord-bot:$imageVersion"

        [void](Test-SteamNetworkConnectivity)

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
        try {
            Invoke-SteamAuthLogin
        }
        catch {
            Write-ErrorExit "steam-auth login failed. Run '.\setup.ps1 steamcmd-download -Retries $Retries' if you want to use the fallback directly."
        }
    }
    "download" {
        Ensure-EnvFile
        Write-Step "Downloading or updating game files"
        Invoke-SteamAuthDownloadOrFallback
    }
    "steamcmd-download" {
        Invoke-SteamCmdDownload
    }
    "steam-network" {
        Invoke-SteamNetworkDiagnostics
    }
    "smoke" {
        Invoke-SmokeTest
    }
    "setup" {
        Write-Step "Preparing .env"
        Ensure-EnvFile

        Write-Step "Pulling Docker images"
        Invoke-ComposePullWithDiagnostics

        Write-Step "Running Steam login"
        try {
            Invoke-SteamAuthLogin
        }
        catch {
            Write-Warn "Continuing to download; if steam-auth is not logged in, the script will fall back to SteamCMD."
        }

        Write-Step "Downloading or updating game files"
        Invoke-SteamAuthDownloadOrFallback

        if (-not $NoStart) {
            Invoke-SmokeTest
        }
        else {
            Show-AccessInfo
        }
        Prompt-AdminPanelAfterSetup
    }
    "build" {
        Ensure-EnvFile
        Write-Step "Building local Docker images"
        Invoke-LocalImageBuild
    }
    "build-setup" {
        Write-Step "Preparing .env"
        Ensure-EnvFile

        Write-Step "Building local Docker images"
        Invoke-LocalImageBuild

        Write-Step "Running Steam login"
        try {
            Invoke-SteamAuthLogin
        }
        catch {
            Write-Warn "Continuing to download; if steam-auth is not logged in, the script will fall back to SteamCMD."
        }

        Write-Step "Downloading or updating game files"
        Invoke-SteamAuthDownloadOrFallback

        if (-not $NoStart) {
            Invoke-SmokeTest
        }
        else {
            Show-AccessInfo
        }
        Prompt-AdminPanelAfterSetup
    }
    "start" {
        Ensure-EnvFile
        Write-Step "Starting server"
        $upArgs = Get-UpArgs
        Invoke-ComposeUpWithDiagnostics -UpArgs $upArgs
        Show-AccessInfo
    }
    "build-start" {
        Ensure-EnvFile
        Write-Step "Building local Docker images"
        Invoke-LocalImageBuild

        Write-Step "Starting server from local images"
        $upArgs = Get-UpArgs
        Invoke-BuildCompose @upArgs
        Show-AccessInfo
    }
    "stop" {
        Write-Step "Stopping server"
        Invoke-ComposeWithDiagnostics -Operation "Stopping server" -ComposeArgs @("down")
    }
    "restart" {
        Ensure-EnvFile
        Write-Step "Restarting server"
        Invoke-ComposeWithDiagnostics -Operation "Stopping server" -ComposeArgs @("down")
        $upArgs = Get-UpArgs
        Invoke-ComposeUpWithDiagnostics -UpArgs $upArgs
        Show-AccessInfo
    }
    "logs" {
        Ensure-EnvFile
        Write-Step "Following logs; press Ctrl+C to exit"
        Invoke-Compose logs -f
    }
    "status" {
        Ensure-EnvFile
        Write-Step "Showing container status"
        Invoke-ComposeWithDiagnostics -Operation "Showing container status" -ComposeArgs @("ps")
    }
    "update" {
        Ensure-EnvFile
        Write-Step "Updating images and restarting"
        Invoke-ComposePullWithDiagnostics
        Invoke-ComposeWithDiagnostics -Operation "Stopping server" -ComposeArgs @("down")
        $upArgs = Get-UpArgs
        Invoke-ComposeUpWithDiagnostics -UpArgs $upArgs
        Show-AccessInfo
    }
    "build-update" {
        Ensure-EnvFile
        Write-Step "Rebuilding local images and restarting"
        Invoke-LocalImageBuild
        Invoke-BuildCompose down
        $upArgs = Get-UpArgs
        Invoke-BuildCompose @upArgs
        Show-AccessInfo
    }
    "backup" {
        Invoke-SavesBackup
    }
    "join-info" {
        Show-JoinInfo
    }
    "admin" {
        Invoke-AdminPanel
    }
    "admin-public" {
        Invoke-AdminPanel -Public
    }
    "admin-token-rotate" {
        Invoke-AdminTokenRotate
    }
    "admin-service-install" {
        Invoke-AdminSystemdUnsupported
    }
    "admin-service-install-public" {
        Invoke-AdminSystemdUnsupported
    }
    "admin-service-start" {
        Invoke-AdminSystemdUnsupported
    }
    "admin-service-stop" {
        Invoke-AdminSystemdUnsupported
    }
    "admin-service-restart" {
        Invoke-AdminSystemdUnsupported
    }
    "admin-service-status" {
        Invoke-AdminSystemdUnsupported
    }
    "admin-service-logs" {
        Invoke-AdminSystemdUnsupported
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
