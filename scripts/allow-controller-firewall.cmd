@echo off
setlocal DisableDelayedExpansion
set "KOSEN_FIREWALL_SCRIPT=%~f0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$source = [IO.File]::ReadAllText($env:KOSEN_FIREWALL_SCRIPT); $body = $source.Substring($source.IndexOf('# POWERSHELL-' + 'BEGIN')); & ([scriptblock]::Create($body))"
exit /b %errorlevel%

# POWERSHELL-BEGIN
param(
    [switch]$Elevated,
    [switch]$ConfigureOnly,
    [switch]$LaunchGame,
    [string]$GameExe
)

$ErrorActionPreference = 'Stop'
$pauseAtEnd = -not ($LaunchGame -or $ConfigureOnly)
$exitCode = 1
$ruleName = 'KosenChanbara-Controller-UDP'

function Get-GameUdpBlocks {
    foreach ($rule in @(Get-NetFirewallRule -Direction Inbound -Action Block -Enabled True -PolicyStore ActiveStore)) {
        $app = $rule | Get-NetFirewallApplicationFilter
        if ($app.Program -ne $GameExe) { continue }
        $port = $rule | Get-NetFirewallPortFilter
        if ([string]$port.Protocol -in @('UDP', '17', 'Any', '256')) { $rule }
    }
}

function Test-GameFirewall {
    try {
        $rule = Get-NetFirewallRule -Name $ruleName -PolicyStore ActiveStore -ErrorAction Stop
        if ($rule.Enabled -ne 'True' -or $rule.Direction -ne 'Inbound' -or $rule.Action -ne 'Allow' -or $rule.Profile -ne 'Any') { return $false }
        $app = $rule | Get-NetFirewallApplicationFilter
        $port = $rule | Get-NetFirewallPortFilter
        $address = $rule | Get-NetFirewallAddressFilter
        return ($app.Program -eq $GameExe -and [string]$port.Protocol -in @('UDP', '17') -and
            [string]$port.LocalPort -eq 'Any' -and $address.RemoteAddress -contains 'LocalSubnet' -and
            @(Get-GameUdpBlocks).Count -eq 0)
    } catch { return $false }
}

function Set-GameFirewall {
    $settings = @{
        Description = 'Controller UDP, server discovery replies and WebRTC from the local LAN.'
        Direction = 'Inbound'
        Action = 'Allow'
        Enabled = 'True'
        Program = $GameExe
        Protocol = 'UDP'
        LocalPort = 'Any'
        RemoteAddress = 'LocalSubnet'
        Profile = 'Any'
        PolicyStore = 'PersistentStore'
    }
    if (Get-NetFirewallRule -Name $ruleName -PolicyStore PersistentStore -ErrorAction SilentlyContinue) {
        Set-NetFirewallRule -Name $ruleName @settings
    } else {
        New-NetFirewallRule -Name $ruleName -DisplayName 'KosenChanbara Controller UDP' @settings | Out-Null
    }
    # A previous Cancel on Windows' firewall prompt can create explicit block
    # rules that override an allow. Only this exact exe's inbound UDP blocks
    # are disabled. Managed policies cannot be overridden by this script.
    foreach ($blocked in @(Get-GameUdpBlocks)) {
        Disable-NetFirewallRule -Name $blocked.Name -PolicyStore PersistentStore
    }
    if (-not (Test-GameFirewall)) { throw 'The firewall policy did not accept the controller rule.' }
}

try {
    if ($LaunchGame -and -not $GameExe) {
        $GameExe = Join-Path $PSScriptRoot '..\Game\KosenChanbara.exe'
    }
    if (-not $GameExe) {
        $gamePaths = @(Get-Process -Name 'KosenChanbara' -ErrorAction SilentlyContinue |
            ForEach-Object { if ($_.Path) { [IO.Path]::GetFullPath($_.Path) } } |
            Sort-Object -Unique)
        if ($gamePaths.Count -eq 0) { throw 'Start KosenChanbara.exe first, then run this file again.' }
        if ($gamePaths.Count -gt 1) { throw 'Several game folders are running. Close the other copies and retry.' }
        $GameExe = $gamePaths[0]
    }
    $GameExe = [IO.Path]::GetFullPath($GameExe)
    if (-not (Test-Path -LiteralPath $GameExe -PathType Leaf)) { throw "Game executable not found: $GameExe" }
    if ($LaunchGame) {
        $otherCopies = @(Get-Process -Name 'KosenChanbara' -ErrorAction SilentlyContinue |
            Where-Object { -not $_.Path -or $_.Path -ne $GameExe })
        if ($otherCopies.Count -gt 0) { throw 'Another copy of KosenChanbara is running. Close it before starting this copy.' }
    }

    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
    $isAdmin = $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($ConfigureOnly -and -not $isAdmin) { throw 'Administrator permission is required.' }
    if (-not (Test-GameFirewall)) {
        if ($isAdmin) {
            Set-GameFirewall
        } else {
            if ($Elevated) { throw 'Administrator permission is required.' }
            Write-Host 'Please accept the Windows administrator prompt to allow LAN controller input.'
            # Share one implementation between the standalone .cmd and the
            # packaged .ps1. Only configuration runs elevated, not the game.
            if ($PSCommandPath) {
                $body = [IO.File]::ReadAllText($PSCommandPath)
            } else {
                $source = [IO.File]::ReadAllText($env:KOSEN_FIREWALL_SCRIPT)
                $body = $source.Substring($source.IndexOf('# POWERSHELL-' + 'BEGIN'))
            }
            $exeLiteral = "'" + $GameExe.Replace("'", "''") + "'"
            $command = "& {`n$body`n} -Elevated -ConfigureOnly -GameExe $exeLiteral"
            $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
            $child = Start-Process -FilePath "$PSHOME\powershell.exe" -Verb RunAs -Wait -PassThru -ArgumentList @(
                '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded
            )
            if ($child.ExitCode -ne 0) { throw 'Firewall setup did not complete. See the administrator window error and retry.' }
        }
    }

    if ($LaunchGame) {
        $running = @(Get-Process -Name 'KosenChanbara' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $GameExe })
        if ($running.Count -gt 0) {
            $shell = New-Object -ComObject WScript.Shell
            [void]$shell.AppActivate($running[0].Id)
        } else {
            Start-Process -FilePath $GameExe -WorkingDirectory ([IO.Path]::GetDirectoryName($GameExe)) -ArgumentList '-single-instance' | Out-Null
        }
    } elseif (-not $ConfigureOnly) {
        Write-Host "`nController firewall permission saved." -ForegroundColor Green
        Write-Host "Game: $GameExe"
        Write-Host 'Allowed: game UDP from LocalSubnet, including controller, discovery and WebRTC.'
        Write-Host 'Return to the registration screen and hold Guard + Reset for 1 second.'
    }
    $exitCode = 0
} catch {
    Write-Host "`nSetup failed: $($_.Exception.Message)" -ForegroundColor Red
    $pauseAtEnd = $true
} finally {
    if ($pauseAtEnd) { [void](Read-Host 'Press Enter to close') }
}

exit $exitCode
