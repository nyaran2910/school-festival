# No Pester or Windows firewall changes: run with Windows PowerShell or pwsh.
$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\allow-controller-firewall.cmd'))
$body = $source.Substring($source.IndexOf('# POWERSHELL-' + 'BEGIN'))
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($body, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors -join "`n") }
foreach ($statement in $ast.EndBlock.Statements) {
    if ($statement -is [System.Management.Automation.Language.FunctionDefinitionAst]) {
        Invoke-Expression $statement.Extent.Text
    }
}

$GameExe = "C:\Users\Operator O'Brien\Desktop\unity\Game\KosenChanbara.exe"
$ruleName = 'KosenChanbara-Controller-UDP'
$script:installed = $false
$script:blocked = $false
$script:managedBlock = $false
$script:storedPath = ''
$script:created = $script:updated = $script:unblocked = 0

function Get-NetFirewallRule {
    param($Name, $PolicyStore, $Direction, $Action, $Enabled, $ErrorAction)
    if ($Action -eq 'Block') {
        if ($script:blocked) { [pscustomobject]@{ Name = 'PreviousPromptBlock' } }
    } elseif ($script:installed) {
        [pscustomobject]@{ Enabled = 'True'; Direction = 'Inbound'; Action = 'Allow'; Profile = 'Any' }
    } elseif ($ErrorAction -eq 'Stop') { throw 'No rule yet' }
}
function Get-NetFirewallApplicationFilter { process { [pscustomobject]@{ Program = $script:storedPath } } }
function Get-NetFirewallPortFilter { process { [pscustomobject]@{ Protocol = 'UDP'; LocalPort = @('Any') } } }
function Get-NetFirewallAddressFilter { process { [pscustomobject]@{ RemoteAddress = @('LocalSubnet') } } }
function New-NetFirewallRule {
    param($Program)
    $script:installed = $true; $script:storedPath = $Program; $script:created++
}
function Set-NetFirewallRule { param($Program) $script:storedPath = $Program; $script:updated++ }
function Disable-NetFirewallRule {
    if ($script:managedBlock) { throw 'Managed firewall block cannot be changed' }
    $script:blocked = $false; $script:unblocked++
}
function Assert-True($Value, $Message) { if (-not $Value) { throw $Message } }

Assert-True (-not (Test-GameFirewall)) 'Fresh PC must require configuration.'
Set-GameFirewall
Assert-True ((Test-GameFirewall) -and $script:created -eq 1) 'First configuration must allow the current exe.'
Assert-True ((Test-GameFirewall) -and $script:updated -eq 0) 'An unchanged installation must need no update/elevation.'
$GameExe = 'D:\New Desktop\unity\Game\KosenChanbara.exe'
Assert-True (-not (Test-GameFirewall)) 'A moved exe must require its own path.'
Set-GameFirewall
Assert-True ((Test-GameFirewall) -and $script:created -eq 1 -and $script:updated -eq 1) 'Moving must update rather than duplicate the rule.'
$script:blocked = $true
Assert-True (-not (Test-GameFirewall)) 'An explicit block must override an existing allow.'
Set-GameFirewall
Assert-True ((Test-GameFirewall) -and $script:unblocked -eq 1) 'A previous prompt rejection must be handled.'
$script:blocked = $script:managedBlock = $true
$rejected = $false
try { Set-GameFirewall } catch { $rejected = $true }
Assert-True $rejected 'Managed policy failure must remain an error, not a reported success.'

# Validate the exact elevation payload with a quoted/non-ASCII installation path.
$path = "C:\Users\O'Brien\Desktop\$([char]0x65e5)$([char]0x672c)\Game\KosenChanbara.exe"
$literal = "'" + $path.Replace("'", "''") + "'"
$command = "& {`n$body`n} -Elevated -ConfigureOnly -GameExe $literal"
[void][System.Management.Automation.Language.Parser]::ParseInput($command, [ref]$tokens, [ref]$parseErrors)
Assert-True ($parseErrors.Count -eq 0) 'Elevation must preserve special folder names.'
Assert-True ([Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command)).Length -lt 30000) 'Elevation must fit the Windows command line.'
Write-Host 'Launcher checks passed: initial setup, reuse, relocation, explicit blocks, managed failure, payload parsing.'
