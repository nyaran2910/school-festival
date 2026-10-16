# Pure mocks: no network or firewall settings are changed.
$ErrorActionPreference = 'Stop'
$global:sfTestNetworkScript = Join-Path $PSScriptRoot '..\server-network.ps1'
$global:sfTestOutput = Join-Path ([IO.Path]::GetTempPath()) ('sf-network-' + [guid]::NewGuid() + '.json')
$global:sfTestNode = 'C:\Program Files\nodejs\node.exe'
$global:sfTestWifi = [pscustomobject]@{ Name='School Wi-Fi'; InterfaceType=71; NdisPhysicalMedium=9; InterfaceGuid=[guid]::NewGuid(); ifIndex=1; Status='Up' }
$global:sfTestLan = [pscustomobject]@{ Name='USB Ethernet'; InterfaceType=6; NdisPhysicalMedium=14; InterfaceGuid=[guid]::NewGuid(); ifIndex=2; Status='Up' }
$global:sfTestAmbiguous = $false
$global:sfTestShared = $true
$global:sfTestRulesReady = $true
$global:sfTestOtherShared = $false
function Get-NetAdapter { param([switch]$Physical)
    $global:sfTestWifi; $global:sfTestLan
    if ($global:sfTestAmbiguous) { $global:sfTestLan }
}
function New-Object {
    param($ComObject)
    if ($ComObject -ne 'HNetCfg.HNetShare') { throw 'Unexpected constructor in read-only check' }
    $manager = [pscustomobject]@{}
    $manager | Add-Member ScriptMethod EnumEveryConnection { @(1,2,3) }
    $manager | Add-Member ScriptMethod NetConnectionProps {
        param($connection)
        if ($connection -eq 1) { [pscustomobject]@{ Guid=$global:sfTestWifi.InterfaceGuid.ToString('B'); Name=$global:sfTestWifi.Name } }
        elseif ($connection -eq 2) { [pscustomobject]@{ Guid=$global:sfTestLan.InterfaceGuid.ToString('B'); Name=$global:sfTestLan.Name } }
        else { [pscustomobject]@{ Guid=[guid]::NewGuid().ToString('B'); Name='VPN' } }
    }
    $manager | Add-Member ScriptMethod INetSharingConfigurationForINetConnection {
        param($connection)
        [pscustomobject]@{ SharingEnabled=($global:sfTestShared -and $connection -le 2) -or ($connection -eq 3 -and $global:sfTestOtherShared); SharingConnectionType=($connection - 1) }
    }
    $manager
}
function Get-NetFirewallRule { param($Name, $PolicyStore, $ErrorAction)
    if ($global:sfTestRulesReady) { [pscustomobject]@{ Name=$Name; Enabled='True'; Direction='Inbound'; Action='Allow'; Profile='Any' } }
}
function Get-NetFirewallApplicationFilter { param($Program, $ErrorAction) process {
    if (-not $Program) { [pscustomobject]@{ Program=$global:sfTestNode } }
} }
function Get-NetFirewallPortFilter { process {
    $phone = $_.Name -like '*.PhoneServer.*'
    $discovery = $_.Name -like '*.Discovery'
    [pscustomobject]@{ Protocol=$(if ($discovery) {'UDP'} else {'TCP'}); LocalPort=$(if ($discovery) {if ($phone) {42045} else {42044}} else {if ($phone) {8080} else {3080}}) }
} }
function Get-NetFirewallAddressFilter { process { [pscustomobject]@{ RemoteAddress='LocalSubnet' } } }
function Get-NetFirewallInterfaceFilter { process { [pscustomobject]@{ InterfaceAlias=$global:sfTestLan.Name } } }
function Get-Service { param($Name) [pscustomobject]@{ Status='Running' } }
function Get-NetIPAddress { param($InterfaceIndex, $AddressFamily)
    [pscustomobject]@{ IPAddress=$(if ($InterfaceIndex -eq 1) {'10.10.1.2'} else {'192.168.137.1'}); PrefixLength=24; AddressState='Preferred' }
}
function Assert-True($Value, $Message) { if (-not $Value) { throw $Message } }
try {
    & $global:sfTestNetworkScript -CheckOnly -NodePath $global:sfTestNode -OutputPath $global:sfTestOutput
    Assert-True ($LASTEXITCODE -eq 0) 'An unchanged ICS/firewall setup must avoid elevation.'
    $config = Get-Content -Raw -LiteralPath $global:sfTestOutput | ConvertFrom-Json
    Assert-True ($config.lanAddress -eq '192.168.137.1' -and $config.lanAlias -eq $global:sfTestLan.Name) 'Export the selected LAN for discovery.'
    $global:sfTestRulesReady = $false
    & $global:sfTestNetworkScript -CheckOnly -NodePath $global:sfTestNode -OutputPath $global:sfTestOutput
    Assert-True ($LASTEXITCODE -eq 10) 'Missing LAN firewall rules must require setup.'
    $global:sfTestRulesReady = $true; $global:sfTestShared = $false
    & $global:sfTestNetworkScript -CheckOnly -NodePath $global:sfTestNode -OutputPath $global:sfTestOutput
    Assert-True ($LASTEXITCODE -eq 10) 'Disabled ICS must require setup.'
    $global:sfTestShared = $true; $global:sfTestAmbiguous = $true
    & $global:sfTestNetworkScript -CheckOnly -NodePath $global:sfTestNode -OutputPath $global:sfTestOutput
    Assert-True ($LASTEXITCODE -eq 1) 'Multiple Ethernet adapters must fail rather than change a guessed network.'
    $global:sfTestAmbiguous = $false; $global:sfTestOtherShared = $true
    & $global:sfTestNetworkScript -CheckOnly -NodePath $global:sfTestNode -OutputPath $global:sfTestOutput
    Assert-True ($LASTEXITCODE -eq 1) 'Existing unrelated ICS must remain untouched.'
    Write-Host 'Server network checks passed: reuse, interface selection, missing rules, disabled sharing, ambiguity, unrelated ICS.'
} finally { Remove-Item -LiteralPath $global:sfTestOutput -Force -ErrorAction SilentlyContinue }
