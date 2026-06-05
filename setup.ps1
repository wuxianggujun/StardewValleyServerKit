$scriptPath = Join-Path $PSScriptRoot "scripts\sdv-server.ps1"
$scriptRoot = Split-Path -Parent $scriptPath
$previousScriptRoot = $env:SVSK_POWERSHELL_SCRIPT_ROOT

try {
    $env:SVSK_POWERSHELL_SCRIPT_ROOT = $scriptRoot
    $source = [System.IO.File]::ReadAllText($scriptPath, [System.Text.Encoding]::UTF8)
    $scriptBlock = [ScriptBlock]::Create($source)
    & $scriptBlock @args
}
finally {
    if ($null -eq $previousScriptRoot) {
        Remove-Item Env:\SVSK_POWERSHELL_SCRIPT_ROOT -ErrorAction SilentlyContinue
    }
    else {
        $env:SVSK_POWERSHELL_SCRIPT_ROOT = $previousScriptRoot
    }
}
