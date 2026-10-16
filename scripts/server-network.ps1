param(
    [switch]$CheckOnly,
    [Parameter(Mandatory=$true)][string]$NodePath,
    [Parameter(Mandatory=$true)][string]$OutputPath,
    [string]$WifiAlias,
    [string]$LanAlias
)
$ErrorActionPreference = 'Stop'
try {
    # Hardware adapters only: VPN/Hyper-V adapters must never be shared by guess.
    $adapters = @(Get-NetAdapter -Physical | Where-Object Status -eq 'Up')
    $wifi = @($adapters | Where-Object { if ($WifiAlias) { $_.Name -eq $WifiAlias } else { $_.InterfaceType -eq 71 -or $_.NdisPhysicalMedium -eq 9 } })
    $lan = @($adapters | Where-Object { if ($LanAlias) { $_.Name -eq $LanAlias } else { $_.InterfaceType -eq 6 -and $_.NdisPhysicalMedium -ne 9 } })
    if ($wifi.Count -ne 1 -or $lan.Count -ne 1) {
        throw 'Connect one school Wi-Fi adapter and one Ethernet adapter. For multiple adapters set KOSEN_WIFI_ADAPTER and KOSEN_LAN_ADAPTER to their adapter names.'
    }
    $wifi = $wifi[0]; $lan = $lan[0]
    if ($wifi.InterfaceGuid -eq $lan.InterfaceGuid) { throw 'Wi-Fi and LAN must be different adapters.' }
    $manager = New-Object -ComObject HNetCfg.HNetShare
    $connections = @($manager.EnumEveryConnection())
    $public = $null; $private = $null
    foreach ($connection in $connections) {
        $properties = $manager.NetConnectionProps($connection)
        $configuration = $manager.INetSharingConfigurationForINetConnection($connection)
        if ($properties.Guid -eq $wifi.InterfaceGuid.ToString('B')) { $public = $configuration }
        elseif ($properties.Guid -eq $lan.InterfaceGuid.ToString('B')) { $private = $configuration }
        elseif ($configuration.SharingEnabled) {
            throw "Another adapter already uses Internet Connection Sharing: $($properties.Name). Turn off its sharing before retrying."
        }
    }
    if ($null -eq $public -or $null -eq $private) { throw 'Windows Internet Connection Sharing adapters could not be found.' }
    $shared = $public.SharingEnabled -and $public.SharingConnectionType -eq 0 -and
        $private.SharingEnabled -and $private.SharingConnectionType -eq 1
    $specs = @(
        @{ Name='KosenChanbara.PhoneServer.HTTP'; Protocol='TCP'; Port=8080 },
        @{ Name='KosenChanbara.PhoneServer.Discovery'; Protocol='UDP'; Port=42045 },
        @{ Name='KosenChanbara.ScoreServer.HTTP'; Protocol='TCP'; Port=3080 },
        @{ Name='KosenChanbara.ScoreServer.Discovery'; Protocol='UDP'; Port=42044 }
    )
    $promptBlocks = @(Get-NetFirewallApplicationFilter -Program $NodePath -ErrorAction SilentlyContinue |
        Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' -and
            $_.Enabled -eq 'True' -and $_.Name -match '^(TCP|UDP) Query User' })
    $ready = $shared -and $promptBlocks.Count -eq 0 -and (Get-Service -Name SharedAccess).Status -eq 'Running'
    foreach ($spec in $specs) {
        $rule = Get-NetFirewallRule -Name $spec.Name -PolicyStore ActiveStore -ErrorAction SilentlyContinue
        if (-not $rule) { $ready = $false; continue }
        $app = $rule | Get-NetFirewallApplicationFilter
        $port = $rule | Get-NetFirewallPortFilter
        $address = $rule | Get-NetFirewallAddressFilter
        $interface = $rule | Get-NetFirewallInterfaceFilter
        if ($rule.Enabled -ne 'True' -or $rule.Direction -ne 'Inbound' -or $rule.Action -ne 'Allow' -or
            $rule.Profile -ne 'Any' -or $app.Program -ne $NodePath -or
            [string]$port.Protocol -ne $spec.Protocol -or [string]$port.LocalPort -ne [string]$spec.Port -or
            [string]$address.RemoteAddress -ne 'LocalSubnet' -or [string]$interface.InterfaceAlias -ne $lan.Name) { $ready = $false }
    }
    if (-not $CheckOnly) {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = New-Object Security.Principal.WindowsPrincipal($identity)
        if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator permission is required for network setup.' }
        Start-Service SharedAccess
        if (-not $shared) {
            # Back up before the first change; sharing is intentionally persistent.
            $backup = "$OutputPath.before.json"
            if (-not (Test-Path -LiteralPath $backup)) {
                @{ Wifi=$wifi.Name; Lan=$lan.Name;
                   Addresses=@(Get-NetIPAddress -InterfaceIndex $lan.ifIndex -AddressFamily IPv4 | Select-Object IPAddress,PrefixLength,PrefixOrigin);
                   Routes=@(Get-NetRoute -InterfaceIndex $lan.ifIndex -AddressFamily IPv4 | Select-Object DestinationPrefix,NextHop);
                   Dns=@(Get-DnsClientServerAddress -InterfaceIndex $lan.ifIndex -AddressFamily IPv4 | Select-Object -ExpandProperty ServerAddresses)
                } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $backup -Encoding UTF8
            }
            if ($public.SharingEnabled) { $public.DisableSharing() }
            if ($private.SharingEnabled) { $private.DisableSharing() }
            $public.EnableSharing(0)
            $private.EnableSharing(1)
        }
        foreach ($spec in $specs) {
            $settings = @{
                Direction='Inbound'; Action='Allow'; Enabled='True'; Profile='Any'; Program=$NodePath
                Protocol=$spec.Protocol; LocalPort=$spec.Port; RemoteAddress='LocalSubnet'
                InterfaceAlias=$lan.Name; EdgeTraversalPolicy='Block'; PolicyStore='PersistentStore'
            }
            if (Get-NetFirewallRule -Name $spec.Name -PolicyStore PersistentStore -ErrorAction SilentlyContinue) {
                Set-NetFirewallRule -Name $spec.Name @settings | Out-Null
            } else { New-NetFirewallRule -Name $spec.Name -DisplayName $spec.Name @settings | Out-Null }
        }
        $promptBlocks | Disable-NetFirewallRule | Out-Null
    } elseif (-not $ready) { exit 10 }

    $addresses = @()
    for ($attempt=0; $attempt -lt 20; $attempt++) {
        $addresses = @(Get-NetIPAddress -InterfaceIndex $lan.ifIndex -AddressFamily IPv4 |
            Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.AddressState -eq 'Preferred' })
        if ($addresses.Count -eq 1) { break }
        if ($CheckOnly) { exit 10 }
        Start-Sleep -Milliseconds 500
    }
    if ($addresses.Count -ne 1) { throw 'The shared Ethernet IPv4 address is not ready. Run just server again.' }
    $lanAddress = $addresses[0].IPAddress
    $prefix = $addresses[0].PrefixLength
    if ($prefix -ne 24) { throw 'Expected a /24 ICS LAN. Check Windows Internet Connection Sharing settings.' }
    function Get-IPv4Range([string]$Address, [int]$PrefixLength) {
        [uint64]$number = 0
        foreach ($octet in $Address.Split('.')) { $number = $number * 256 + [uint64]$octet }
        [uint64]$size = [math]::Pow(2, 32 - $PrefixLength)
        [uint64]$first = [math]::Floor($number / $size) * $size
        return @($first, ($first + $size - 1))
    }
    $lanRange = Get-IPv4Range $lanAddress $prefix
    foreach ($address in @(Get-NetIPAddress -InterfaceIndex $wifi.ifIndex -AddressFamily IPv4)) {
        $wifiRange = Get-IPv4Range $address.IPAddress $address.PrefixLength
        if ($lanRange[0] -le $wifiRange[1] -and $wifiRange[0] -le $lanRange[1]) {
            throw 'School Wi-Fi and the shared LAN have overlapping IPv4 subnets. This setup needs a different LAN subnet.'
        }
    }
    @{ wifiAlias=$wifi.Name; lanAlias=$lan.Name; lanAddress=$lanAddress; prefixLength=$prefix } |
        ConvertTo-Json | Set-Content -LiteralPath $OutputPath -Encoding UTF8
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
