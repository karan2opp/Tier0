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
