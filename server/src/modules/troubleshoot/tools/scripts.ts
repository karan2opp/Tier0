/**
 * Fixed, read-only PowerShell scripts (Windows PowerShell 5.1).
 * Rules: no writes to the system, no admin required, every script prints exactly one JSON document.
 * Arrays are wrapped with @() so single results still serialize as arrays.
 */

export const systemInfo = `
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
[pscustomobject]@{
  osName               = $os.Caption
  osVersion            = $os.Version
  osBuild              = $os.BuildNumber
  architecture         = $os.OSArchitecture
  manufacturer         = $cs.Manufacturer
  model                = $cs.Model
  cpu                  = "$($cpu.Name)".Trim()
  cpuCores             = $cpu.NumberOfCores
  cpuLogicalProcessors = $cpu.NumberOfLogicalProcessors
  totalRamGB           = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
  lastBoot             = $os.LastBootUpTime.ToString('o')
  uptimeHours          = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1)
} | ConvertTo-Json -Depth 4 -Compress
`;

export const performanceSnapshot = `
$os = Get-CimInstance Win32_OperatingSystem
$cores = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
$cpuLoad = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
$totalKB = [double]$os.TotalVisibleMemorySize
$freeKB = [double]$os.FreePhysicalMemory
$topCpu = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process |
  Where-Object { $_.Name -ne '_Total' -and $_.Name -ne 'Idle' } |
  Sort-Object PercentProcessorTime -Descending | Select-Object -First 5 |
  ForEach-Object { [pscustomobject]@{ name = $_.Name; pid = $_.IDProcess; cpuPercent = [math]::Round($_.PercentProcessorTime / $cores, 1) } }
$topMem = Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 5 |
  ForEach-Object { [pscustomobject]@{ name = $_.ProcessName; pid = $_.Id; memoryMB = [math]::Round($_.WorkingSet64 / 1MB) } }
[pscustomobject]@{
  cpuPercent  = $cpuLoad
  ramPercent  = [math]::Round(($totalKB - $freeKB) / $totalKB * 100, 1)
  ramUsedGB   = [math]::Round(($totalKB - $freeKB) / 1MB, 1)
  ramTotalGB  = [math]::Round($totalKB / 1MB, 1)
  topByCpu    = @($topCpu)
  topByMemory = @($topMem)
} | ConvertTo-Json -Depth 4 -Compress
`;

export const diskUsage = `
$vols = Get-Volume | Where-Object { "$($_.DriveLetter)" -match '^[A-Za-z]$' -and $_.Size -gt 0 } | ForEach-Object {
  [pscustomobject]@{
    driveLetter = "$($_.DriveLetter)"
    label       = $_.FileSystemLabel
    fileSystem  = $_.FileSystem
    driveType   = "$($_.DriveType)"
    sizeGB      = [math]::Round($_.Size / 1GB, 1)
    freeGB      = [math]::Round($_.SizeRemaining / 1GB, 1)
    freePercent = [math]::Round($_.SizeRemaining / $_.Size * 100, 1)
    health      = "$($_.HealthStatus)"
  }
}
[pscustomobject]@{ volumes = @($vols) } | ConvertTo-Json -Depth 4 -Compress
`;

export const detectDrives = `
$disks = Get-Disk | ForEach-Object {
  $d = $_
  $parts = Get-Partition -DiskNumber $d.Number -ErrorAction SilentlyContinue | ForEach-Object {
    $letter = "$($_.DriveLetter)"
    [pscustomobject]@{
      partitionNumber = $_.PartitionNumber
      driveLetter     = if ($letter -match '^[A-Za-z]$') { $letter } else { $null }
      sizeGB          = [math]::Round($_.Size / 1GB, 1)
      type            = "$($_.Type)"
    }
  }
  [pscustomobject]@{
    number            = $d.Number
    friendlyName      = $d.FriendlyName
    busType           = "$($d.BusType)"
    sizeGB            = [math]::Round($d.Size / 1GB, 1)
    operationalStatus = "$($d.OperationalStatus)"
    healthStatus      = "$($d.HealthStatus)"
    partitionStyle    = "$($d.PartitionStyle)"
    isOffline         = $d.IsOffline
    isReadOnly        = $d.IsReadOnly
    isBoot            = $d.IsBoot
    isSystem          = $d.IsSystem
    partitions        = @($parts)
  }
}
[pscustomobject]@{ disks = @($disks) } | ConvertTo-Json -Depth 5 -Compress
`;

export const diskHealth = `
$items = Get-PhysicalDisk | ForEach-Object {
  $reliability = $null
  try {
    # Usually needs admin; when unavailable we just report null.
    $r = $_ | Get-StorageReliabilityCounter -ErrorAction Stop
    $reliability = [pscustomobject]@{
      temperatureC     = $r.Temperature
      wearPercent      = $r.Wear
      readErrorsTotal  = $r.ReadErrorsTotal
      writeErrorsTotal = $r.WriteErrorsTotal
      powerOnHours     = $r.PowerOnHours
    }
  } catch {}
  [pscustomobject]@{
    friendlyName      = $_.FriendlyName
    mediaType         = "$($_.MediaType)"
    busType           = "$($_.BusType)"
    sizeGB            = [math]::Round($_.Size / 1GB, 1)
    healthStatus      = "$($_.HealthStatus)"
    operationalStatus = (@($_.OperationalStatus) | ForEach-Object { "$_" }) -join ', '
    reliability       = $reliability
  }
}
[pscustomobject]@{ physicalDisks = @($items) } | ConvertTo-Json -Depth 4 -Compress
`;

// powercfg writes its report to a temp file, which is deleted right after reading.
export const batteryHealth = `
$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $b) {
  [pscustomobject]@{ hasBattery = $false } | ConvertTo-Json -Compress
} else {
  $statusNames = @{ 1='Discharging'; 2='On AC power'; 3='Fully charged'; 4='Low'; 5='Critical'; 6='Charging'; 7='Charging (high)'; 8='Charging (low)'; 9='Charging (critical)'; 10='Undefined'; 11='Partially charged' }
  $design = $null; $full = $null; $cycles = $null
  $xmlPath = Join-Path $env:TEMP ("tier0-battery-" + [guid]::NewGuid().ToString() + ".xml")
  try {
    powercfg /batteryreport /xml /output "$xmlPath" | Out-Null
    [xml]$report = Get-Content -LiteralPath $xmlPath -Raw
    $bat = @($report.BatteryReport.Batteries.Battery)[0]
    $design = [double]$bat.DesignCapacity
    $full = [double]$bat.FullChargeCapacity
    # Many laptops report 0 when the cycle count is not supported.
    $cycles = [int]$bat.CycleCount
    if ($cycles -le 0) { $cycles = $null }
  } catch {} finally {
    Remove-Item -LiteralPath $xmlPath -ErrorAction SilentlyContinue
  }
  $status = [int]$b.BatteryStatus
  [pscustomobject]@{
    hasBattery              = $true
    chargePercent           = $b.EstimatedChargeRemaining
    status                  = $statusNames[$status]
    pluggedIn               = $status -ne 1 -and $status -ne 4 -and $status -ne 5
    designCapacityMWh       = $design
    fullChargeCapacityMWh   = $full
    healthPercent           = if ($design -gt 0 -and $full -gt 0) { [math]::Round($full / $design * 100, 1) } else { $null }
    cycleCount              = $cycles
  } | ConvertTo-Json -Depth 4 -Compress
}
`;

export const startupApps = `
$apps = Get-CimInstance Win32_StartupCommand | ForEach-Object {
  [pscustomobject]@{ name = $_.Name; command = $_.Command; location = $_.Location }
}
[pscustomobject]@{ count = @($apps).Count; apps = @($apps) } | ConvertTo-Json -Depth 4 -Compress
`;

// Sends 2 pings to 1.1.1.1 and one DNS lookup for example.com to test connectivity.
export const networkStatus = `
$adapters = Get-NetAdapter | Where-Object { $_.HardwareInterface } | ForEach-Object {
  [pscustomobject]@{ name = $_.Name; description = $_.InterfaceDescription; status = "$($_.Status)"; linkSpeed = $_.LinkSpeed }
}
$gateway = Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1
$pings = @(Test-Connection -ComputerName 1.1.1.1 -Count 2 -ErrorAction SilentlyContinue)
$dnsWorks = $true
try { Resolve-DnsName -Name example.com -Type A -DnsOnly -QuickTimeout -ErrorAction Stop | Out-Null } catch { $dnsWorks = $false }
$dnsServers = Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.ServerAddresses } | ForEach-Object { $_.ServerAddresses } | Select-Object -Unique
[pscustomobject]@{
  adapters          = @($adapters)
  activeInterface   = if ($gateway) { $gateway.InterfaceAlias } else { $null }
  hasDefaultGateway = [bool]$gateway
  internetReachable = $pings.Count -gt 0
  avgLatencyMs      = if ($pings.Count -gt 0) { [math]::Round(($pings | Measure-Object -Property ResponseTime -Average).Average, 1) } else { $null }
  dnsResolves       = $dnsWorks
  dnsServers        = @($dnsServers)
} | ConvertTo-Json -Depth 4 -Compress
`;

export const driverProblems = `
$devices = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
  Where-Object { $_.Status -ne 'OK' -and $_.Status -ne 'Unknown' } | ForEach-Object {
    [pscustomobject]@{ name = $_.FriendlyName; class = $_.Class; status = "$($_.Status)"; problemCode = $_.ConfigManagerErrorCode }
  }
[pscustomobject]@{ count = @($devices).Count; devices = @($devices) } | ConvertTo-Json -Depth 4 -Compress
`;

/** Arguments are validated by Zod before they reach this function (enum + bounded integers only). */
export const recentErrors = ({ log, hours, maxEvents }: { log: "System" | "Application"; hours: number; maxEvents: number }) => `
$levels = @{ 1 = 'Critical'; 2 = 'Error' }
$events = Get-WinEvent -FilterHashtable @{ LogName = '${log}'; Level = 1, 2; StartTime = (Get-Date).AddHours(-${hours}) } -MaxEvents ${maxEvents} -ErrorAction SilentlyContinue |
  ForEach-Object {
    $msg = "$($_.Message)" -split [Environment]::NewLine | Select-Object -First 1
    [pscustomobject]@{
      time     = $_.TimeCreated.ToString('o')
      level    = $levels[[int]$_.Level]
      source   = $_.ProviderName
      eventId  = $_.Id
      message  = if ($msg.Length -gt 300) { $msg.Substring(0, 300) } else { $msg }
    }
  }
[pscustomobject]@{ log = '${log}'; hours = ${hours}; count = @($events).Count; events = @($events) } | ConvertTo-Json -Depth 4 -Compress
`;

/* ---------------- Second set of tools ---------------- */

// Blue screens, unexpected shutdowns and app crashes over the last 30 days (event logs only).
export const crashHistory = `
$since = (Get-Date).AddDays(-30)
function Get-Events($filter, $max) { @(Get-WinEvent -FilterHashtable $filter -MaxEvents $max -ErrorAction SilentlyContinue) }
$blue = Get-Events @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-WER-SystemErrorReporting'; Id = 1001; StartTime = $since } 10
$shutdowns = Get-Events @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-Kernel-Power'; Id = 41; StartTime = $since } 20
$appCrashes = Get-Events @{ LogName = 'Application'; ProviderName = 'Application Error'; Id = 1000; StartTime = $since } 100
$topApps = $appCrashes | ForEach-Object { "$($_.Properties[0].Value)" } | Group-Object | Sort-Object Count -Descending |
  Select-Object -First 5 | ForEach-Object { [pscustomobject]@{ app = $_.Name; crashes = $_.Count } }
$blueList = $blue | ForEach-Object {
  $line = "$($_.Message)" -split [Environment]::NewLine | Select-Object -First 1
  [pscustomobject]@{ time = $_.TimeCreated.ToString('o'); detail = if ($line.Length -gt 200) { $line.Substring(0, 200) } else { $line } }
}
$dumps = $null
try { $dumps = @(Get-ChildItem -LiteralPath (Join-Path $env:SystemRoot 'Minidump') -Filter *.dmp -ErrorAction Stop).Count } catch {}
[pscustomobject]@{
  days                    = 30
  blueScreenCount         = $blue.Count
  blueScreens             = @($blueList)
  unexpectedShutdownCount = $shutdowns.Count
  lastUnexpectedShutdown  = if ($shutdowns.Count) { $shutdowns[0].TimeCreated.ToString('o') } else { $null }
  appCrashCount           = $appCrashes.Count
  topCrashingApps         = @($topApps)
  minidumpCount           = $dumps
} | ConvertTo-Json -Depth 4 -Compress
`;

// Local update history only (QueryHistory does not contact Windows Update), plus pending-reboot flags.
export const windowsUpdateStatus = `
$resultNames = @{ 0 = 'Not started'; 1 = 'In progress'; 2 = 'Succeeded'; 3 = 'Succeeded with errors'; 4 = 'Failed'; 5 = 'Aborted' }
$entries = @()
$historyAvailable = $true
try {
  $searcher = (New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher()
  $total = $searcher.GetTotalHistoryCount()
  if ($total -gt 0) {
    $entries = @($searcher.QueryHistory(0, [math]::Min(30, $total)) | Where-Object { $_.Title } | ForEach-Object {
      [pscustomobject]@{
        date      = $_.Date.ToString('o')
        title     = "$($_.Title)"
        result    = $resultNames[[int]$_.ResultCode]
        errorCode = if ($_.HResult -ne 0) { '0x{0:X8}' -f $_.HResult } else { $null }
      }
    })
  }
} catch { $historyAvailable = $false }
$service = Get-Service -Name wuauserv -ErrorAction SilentlyContinue
$lastSuccess = $entries | Where-Object { $_.result -eq 'Succeeded' } | Select-Object -First 1
[pscustomobject]@{
  historyAvailable     = $historyAvailable
  lastSuccessfulUpdate = $lastSuccess
  recentFailures       = @($entries | Where-Object { $_.result -eq 'Failed' -or $_.result -eq 'Aborted' } | Select-Object -First 5)
  recentUpdates        = @($entries | Select-Object -First 5)
  pendingReboot        = (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired') -or
                         (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending')
  updateService        = if ($service) { [pscustomobject]@{ status = "$($service.Status)"; startType = "$($service.StartType)" } } else { $null }
} | ConvertTo-Json -Depth 4 -Compress
`;

// powercfg is only used with read-only switches: /getactivescheme, /query and /lastwake.
export const powerSettings = `
function Get-Timeout($sub, $setting) {
  try { $out = (powercfg /query SCHEME_CURRENT $sub $setting) | Out-String } catch { return $null }
  $hex = @([regex]::Matches($out, '0x[0-9a-fA-F]{8}') | ForEach-Object { $_.Value })
  if ($hex.Count -lt 2) { return $null }
  [pscustomobject]@{
    pluggedInMinutes = [math]::Round([Convert]::ToInt32($hex[-2], 16) / 60, 1)
    onBatteryMinutes = [math]::Round([Convert]::ToInt32($hex[-1], 16) / 60, 1)
  }
}
$plan = $null
try {
  $active = (powercfg /getactivescheme) | Out-String
  $m = [regex]::Match($active, '([0-9a-fA-F-]{36})\\s*\\((.+?)\\)')
  if ($m.Success) { $plan = [pscustomobject]@{ name = $m.Groups[2].Value; guid = $m.Groups[1].Value } }
} catch {}
$lastWake = $null
try { $lastWake = ((powercfg /lastwake) | Out-String).Trim() } catch {}
if ($lastWake -and $lastWake.Length -gt 300) { $lastWake = $lastWake.Substring(0, 300) }
$hibernate = (Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power' -Name HibernateEnabled -ErrorAction SilentlyContinue).HibernateEnabled
[pscustomobject]@{
  activePlan         = $plan
  sleepAfter         = Get-Timeout 'SUB_SLEEP' 'STANDBYIDLE'
  hibernateAfter     = Get-Timeout 'SUB_SLEEP' 'HIBERNATEIDLE'
  screenOffAfter     = Get-Timeout 'SUB_VIDEO' 'VIDEOIDLE'
  hibernateEnabled   = if ($null -ne $hibernate) { [bool]$hibernate } else { $null }
  lastWake           = $lastWake
  note               = '0 minutes means never'
} | ConvertTo-Json -Depth 4 -Compress
`;

// Temperature is often unavailable without admin rights; then it is reported as null.
export const thermalStatus = `
$tempC = $null
try {
  $zones = @(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop)
  if ($zones.Count) { $tempC = [math]::Round((($zones | Measure-Object -Property CurrentTemperature -Maximum).Maximum / 10) - 273.15, 1) }
} catch {}
$perf = Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation -Filter "Name='_Total'" -ErrorAction SilentlyContinue
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$throttleEvents = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-Kernel-Processor-Power'; Id = 37; StartTime = (Get-Date).AddDays(-7) } -MaxEvents 50 -ErrorAction SilentlyContinue)
[pscustomobject]@{
  temperatureC              = $tempC
  temperatureAvailable      = $null -ne $tempC
  cpuPerformancePercent     = if ($perf) { $perf.PercentProcessorPerformance } else { $null }
  percentOfMaxFrequency     = if ($perf) { $perf.PercentofMaximumFrequency } else { $null }
  currentMHz                = if ($perf) { $perf.ProcessorFrequency } else { $cpu.CurrentClockSpeed }
  maxMHz                    = $cpu.MaxClockSpeed
  firmwareThrottleEvents7d  = $throttleEvents.Count
} | ConvertTo-Json -Depth 4 -Compress
`;

export const displayInfo = `
$gpus = Get-CimInstance Win32_VideoController | ForEach-Object {
  [pscustomobject]@{
    name          = $_.Name
    status        = $_.Status
    driverVersion = $_.DriverVersion
    driverDate    = if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } else { $null }
    resolution    = if ($_.CurrentHorizontalResolution) { "$($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution)" } else { $null }
    refreshRateHz = $_.CurrentRefreshRate
  }
}
$monitors = Get-PnpDevice -Class Monitor -PresentOnly -ErrorAction SilentlyContinue |
  ForEach-Object { [pscustomobject]@{ name = $_.FriendlyName; status = "$($_.Status)" } }
$dpi = (Get-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop\\WindowMetrics' -Name AppliedDPI -ErrorAction SilentlyContinue).AppliedDPI
[pscustomobject]@{
  gpus           = @($gpus)
  monitors       = @($monitors)
  scalingPercent = if ($dpi) { [math]::Round($dpi / 96 * 100) } else { $null }
} | ConvertTo-Json -Depth 4 -Compress
`;

// Shared helper: Windows privacy switch for camera / microphone access (registry read only).
const privacySetting = (capability: string) =>
  `(Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\${capability}' -Name Value -ErrorAction SilentlyContinue).Value`;

export const audioDevices = `
$controllers = Get-CimInstance Win32_SoundDevice | ForEach-Object { [pscustomobject]@{ name = $_.Name; status = $_.Status } }
$endpoints = Get-PnpDevice -Class AudioEndpoint -PresentOnly -ErrorAction SilentlyContinue |
  ForEach-Object { [pscustomobject]@{ name = $_.FriendlyName; status = "$($_.Status)" } }
$services = Get-Service -Name Audiosrv, AudioEndpointBuilder -ErrorAction SilentlyContinue |
  ForEach-Object { [pscustomobject]@{ name = $_.Name; status = "$($_.Status)" } }
[pscustomobject]@{
  soundControllers        = @($controllers)
  endpoints               = @($endpoints)
  audioServices           = @($services)
  microphoneAccessSetting = ${privacySetting("microphone")}
} | ConvertTo-Json -Depth 4 -Compress
`;

// Paired Bluetooth devices (phones, earbuds, other PCs) carry personal names, so they are only counted.
export const peripheralDevices = `
$classes = 'Keyboard', 'Mouse', 'Camera', 'Image', 'Bluetooth', 'USB'
$devices = @(Get-PnpDevice -PresentOnly -Class $classes -ErrorAction SilentlyContinue)
function Test-Paired($d) { "$($d.InstanceId)" -match '^(BTHENUM|BTHLE|BTHLEDEVICE)\\\\' }
function Get-SafeName($d) { if (Test-Paired $d) { 'Paired Bluetooth device' } else { $d.FriendlyName } }
$byClass = $devices | Group-Object Class | ForEach-Object {
  $hardware = @($_.Group | Where-Object { -not (Test-Paired $_) })
  [pscustomobject]@{
    class             = $_.Name
    count             = $hardware.Count
    pairedDeviceCount = @($_.Group | Where-Object { Test-Paired $_ }).Count
    problems          = @($_.Group | Where-Object { $_.Status -ne 'OK' } | ForEach-Object { [pscustomobject]@{ name = Get-SafeName $_; status = "$($_.Status)"; problemCode = $_.ConfigManagerErrorCode } })
    devices           = @($hardware | Select-Object -First 8 | ForEach-Object { $_.FriendlyName })
  }
}
[pscustomobject]@{
  deviceClasses       = @($byClass)
  cameraAccessSetting = ${privacySetting("webcam")}
} | ConvertTo-Json -Depth 5 -Compress
`;

// Network name (SSID) and access point address (BSSID) are deliberately not returned.
export const wifiDetails = `
$fields = @{}
try {
  foreach ($line in (netsh wlan show interfaces)) {
    if ($line -match '^\\s*([^:]+?)\\s*:\\s*(.+?)\\s*$') { if (-not $fields.ContainsKey($Matches[1])) { $fields[$Matches[1]] = $Matches[2] } }
  }
} catch {}
$adapter = Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.PhysicalMediaType -eq 'Native 802.11' } | Select-Object -First 1
$signal = $null
if ($fields['Signal'] -match '(\\d+)') { $signal = [int]$Matches[1] }
[pscustomobject]@{
  hasWifiAdapter       = [bool]$adapter
  state                = $fields['State']
  connectedToNetwork   = $fields.ContainsKey('SSID') -and $fields['State'] -eq 'connected'
  signalPercent        = $signal
  radioType            = $fields['Radio type']
  band                 = $fields['Band']
  channel              = $fields['Channel']
  receiveRateMbps      = $fields['Receive rate (Mbps)']
  transmitRateMbps     = $fields['Transmit rate (Mbps)']
  adapter              = if ($adapter) { [pscustomobject]@{ name = $adapter.InterfaceDescription; status = "$($adapter.Status)"; driverVersion = $adapter.DriverVersion; driverDate = $adapter.DriverDate; driverProvider = $adapter.DriverProvider } } else { $null }
} | ConvertTo-Json -Depth 4 -Compress
`;

export const securityStatus = `
$defender = $null
try {
  $s = Get-MpComputerStatus -ErrorAction Stop
  $defender = [pscustomobject]@{
    antivirusEnabled          = $s.AntivirusEnabled
    realTimeProtectionEnabled = $s.RealTimeProtectionEnabled
    signatureAgeDays          = $s.AntivirusSignatureAge
    quickScanAgeDays          = $s.QuickScanAge
    tamperProtected           = $s.IsTamperProtected
  }
} catch {}
$products = @()
try {
  $products = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction Stop | ForEach-Object {
    $hex = '{0:X6}' -f [int]$_.productState
    [pscustomobject]@{ name = $_.displayName; enabled = $hex.Substring(2, 2) -in '10', '11'; upToDate = $hex.Substring(4, 2) -eq '00' }
  })
} catch {}
$firewall = Get-NetFirewallProfile -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ profile = $_.Name; enabled = [bool]$_.Enabled } }
[pscustomobject]@{
  defender          = $defender
  antivirusProducts = @($products)
  firewallProfiles  = @($firewall)
} | ConvertTo-Json -Depth 4 -Compress
`;

// Programs from the uninstall registry keys, driver installs and Windows updates in the last 14 days.
export const recentInstalls = `
$since = (Get-Date).AddDays(-14)
$keys = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
$culture = [Globalization.CultureInfo]::InvariantCulture
$programs = Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and $_.InstallDate -match '^\\d{8}$' } |
  ForEach-Object {
    # Some installers write invalid dates (e.g. month 13); those entries are skipped instead of failing.
    $date = [datetime]::MinValue
    $valid = [datetime]::TryParseExact($_.InstallDate, 'yyyyMMdd', $culture, [Globalization.DateTimeStyles]::None, [ref]$date)
    if ($valid -and $date -ge $since.Date) { [pscustomobject]@{ name = $_.DisplayName; version = $_.DisplayVersion; publisher = $_.Publisher; installed = $date.ToString('yyyy-MM-dd') } }
  } | Sort-Object installed -Descending | Select-Object -First 15
$drivers = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-UserPnp'; Id = 20001; StartTime = $since } -MaxEvents 15 -ErrorAction SilentlyContinue |
  ForEach-Object { [pscustomobject]@{ time = $_.TimeCreated.ToString('o'); device = "$($_.Properties[1].Value)" } })
$updates = @(Get-HotFix -ErrorAction SilentlyContinue | Where-Object { $_.InstalledOn -and $_.InstalledOn -ge $since } |
  ForEach-Object { [pscustomobject]@{ id = $_.HotFixID; description = $_.Description; installed = $_.InstalledOn.ToString('yyyy-MM-dd') } })
[pscustomobject]@{
  days            = 14
  programs        = @($programs)
  driverInstalls  = @($drivers)
  windowsUpdates  = @($updates)
} | ConvertTo-Json -Depth 4 -Compress
`;
