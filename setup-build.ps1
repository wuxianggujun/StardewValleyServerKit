$action = if ($args.Count -gt 0) { $args[0] } else { "build-setup" }
$remainingArgs = if ($args.Count -gt 1) { $args[1..($args.Count - 1)] } else { @() }

& "$PSScriptRoot\scripts\sdv-server.ps1" $action @remainingArgs
