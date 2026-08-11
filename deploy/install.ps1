# ============================================================================
#  Aqaba Yard - office server installer
#  Right-click this file > Run with PowerShell (Administrator required)
# ============================================================================
#  What it does:
#   1. Checks for Node.js 24 (downloads and installs it if missing)
#   2. Stops the old server - required before copying, or Windows will refuse
#      to replace files that are open and the update will not land
#   3. Copies the app to C:\AqabaYard\app (data lives apart in ...\data)
#   4. Checks the runtime - it ships inside this folder, nothing is downloaded
#   5. Registers the auto-start service (Scheduled Task named AqabaYard)
#   6. Opens port 8787 on the firewall for the office network
#   7. Installs Tailscale for the free public https link
#
#  Re-running this script IS the update path. It replaces the app and never
#  touches your data.
#
#  Everything this script prints is in English on purpose: a PowerShell
#  console mangles right-to-left text, and a garbled error message is worse
#  than no message at all.
# ============================================================================

$ErrorActionPreference = 'Stop'
$Root   = 'C:\AqabaYard'
$AppDir = Join-Path $Root 'app'
$Here   = Split-Path -Parent $MyInvocation.MyCommand.Path

# -- 0. Administrator? -------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host ''
  Write-Host '  This script must run as Administrator.' -ForegroundColor Red
  Write-Host '  Start menu > type PowerShell > right-click > Run as administrator,' -ForegroundColor Yellow
  Write-Host '  then run this file again. See COMMANDS.txt for the exact line.' -ForegroundColor Yellow
  Read-Host  '  Press Enter to close'
  exit 1
}

Write-Host ''
Write-Host '=== Aqaba Yard - installation started ===' -ForegroundColor Cyan

# -- 1. Node.js 24 -----------------------------------------------------------
$nodeOk = $false
try {
  $v = (& node -v) 2>$null
  if ($v -match '^v(\d+)\.' -and [int]$Matches[1] -ge 24) { $nodeOk = $true }
} catch {}
if ($nodeOk) {
  Write-Host "  [1/7] Node.js found ($v)" -ForegroundColor Green
} else {
  Write-Host '  [1/7] Downloading Node.js 24 (a minute, depending on the line)...' -ForegroundColor Yellow
  $msi = Join-Path $env:TEMP 'node24.msi'
  Invoke-WebRequest -Uri 'https://nodejs.org/dist/v24.13.0/node-v24.13.0-x64.msi' -OutFile $msi
  Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path','User')
  Write-Host '        Node.js installed' -ForegroundColor Green
}

# -- 2. Stop the old server BEFORE copying anything --------------------------
# This has to come first. Windows will not let you replace a file a running
# process has open, so copying over a live server fails, the script stops
# before it reaches the restart, and the old build keeps serving from memory.
# That is exactly what makes an update look like it never arrived.
Write-Host '  [2/7] Stopping the old server...' -ForegroundColor Yellow
try { Stop-ScheduledTask -TaskName 'AqabaYard' -ErrorAction Stop } catch {}
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*AqabaYard*' } |
  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }
# A moment for Windows to actually release the file handles.
Start-Sleep -Seconds 3

# -- 3. Copy the app ---------------------------------------------------------
Write-Host '  [3/7] Copying the app to C:\AqabaYard\app ...' -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $AppDir, (Join-Path $Root 'data'), (Join-Path $Root 'logs') | Out-Null
# The app is replaced wholesale on every update; the data sits in ...\data
# outside it and is never touched. The runtime ships inside this package, and
# robocopy only moves what changed, so an update takes seconds.
robocopy (Join-Path $Here 'app') $AppDir /MIR /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) {
  throw 'Copy failed. Make sure no second copy of the server is running, then try again.'
}
$global:LASTEXITCODE = 0

# -- 4. Runtime ---------------------------------------------------------------
# The packages ride inside the folder, so there is no download and no waiting
# on the internet here. The fallback below covers the one thing that can still
# leave them missing: copying only half the folder.
Write-Host '  [4/7] Checking the runtime...' -ForegroundColor Yellow
$tsx = Join-Path $AppDir 'node_modules\tsx\dist\cli.mjs'
if (Test-Path $tsx) {
  Write-Host '        Runtime shipped with the package - nothing to download' -ForegroundColor Green
} else {
  Write-Host '        Runtime missing, downloading it (needs internet, a few minutes)...' -ForegroundColor Yellow
  Push-Location $AppDir
  & npm install --omit=dev --no-audit --no-fund --loglevel=error
  $npmCode = $LASTEXITCODE
  Pop-Location
  if ($npmCode -ne 0) { throw 'npm install failed' }
  if (-not (Test-Path $tsx)) { throw 'The runtime is still incomplete after npm install' }
  Write-Host '        Done' -ForegroundColor Green
}

# -- 5. Auto-start service ---------------------------------------------------
Write-Host '  [5/7] Registering the auto-start service...' -ForegroundColor Yellow
$cmd = @"
@echo off
set YARD_DB=C:\AqabaYard\data\yard.db
set PORT=8787
cd /d C:\AqabaYard\app
"C:\Program Files\nodejs\node.exe" node_modules\tsx\dist\cli.mjs src\server\index.ts >> C:\AqabaYard\logs\server.log 2>&1
"@
Set-Content -Path (Join-Path $Root 'start-yard.cmd') -Value $cmd -Encoding ascii

try { Unregister-ScheduledTask -TaskName 'AqabaYard' -Confirm:$false -ErrorAction Stop } catch {}
$action    = New-ScheduledTaskAction -Execute (Join-Path $Root 'start-yard.cmd')
$trigger   = New-ScheduledTaskTrigger -AtStartup
$settings  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
               -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
               -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
Register-ScheduledTask -TaskName 'AqabaYard' -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal | Out-Null
Start-ScheduledTask -TaskName 'AqabaYard'
Write-Host '        The server now starts by itself with the machine' -ForegroundColor Green

# -- 6. Firewall (office network) --------------------------------------------
Write-Host '  [6/7] Opening port 8787 on the local network...' -ForegroundColor Yellow
try { Remove-NetFirewallRule -DisplayName 'AqabaYard' -ErrorAction Stop } catch {}
New-NetFirewallRule -DisplayName 'AqabaYard' -Direction Inbound -Protocol TCP `
  -LocalPort 8787 -Action Allow -Profile Private,Domain | Out-Null

# -- 7. Tailscale - the public https link ------------------------------------
$ts = 'C:\Program Files\Tailscale\tailscale.exe'
if (Test-Path $ts) {
  Write-Host '  [7/7] Tailscale already installed' -ForegroundColor Green
} else {
  Write-Host '  [7/7] Downloading and installing Tailscale...' -ForegroundColor Yellow
  $tsMsi = Join-Path $env:TEMP 'tailscale.msi'
  Invoke-WebRequest -Uri 'https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi' -OutFile $tsMsi
  Start-Process msiexec.exe -ArgumentList "/i `"$tsMsi`" /qn /norestart" -Wait
  Start-Sleep -Seconds 5
}

# -- Did the server actually answer? -----------------------------------------
Start-Sleep -Seconds 4
$build = ''
try {
  $boot = Invoke-RestMethod -Uri 'http://localhost:8787/api/boot' -TimeoutSec 15
  $build = $boot.build
  Write-Host ''
  Write-Host '=== The server is running ===' -ForegroundColor Green
} catch {
  Write-Host ''
  Write-Host '!! The server did not answer yet.' -ForegroundColor Red
  Write-Host '   Check the log: C:\AqabaYard\logs\server.log' -ForegroundColor Red
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' } |
  Select-Object -First 1).IPAddress

Write-Host ''
if ($build -ne '') {
  # The build stamp is the proof an update actually landed. If this date is
  # not today's after an update, the new files did not reach the server.
  Write-Host "  Running build:      $build" -ForegroundColor Cyan
}
Write-Host '  From this machine:  http://localhost:8787' -ForegroundColor Cyan
Write-Host "  From the office:    http://${ip}:8787" -ForegroundColor Cyan
Write-Host ''
Write-Host '  Two more commands for the public link (first install only):' -ForegroundColor Yellow
Write-Host '   1) & "C:\Program Files\Tailscale\tailscale.exe" up'
Write-Host '      (opens a browser - sign in with your Google account)'
Write-Host '   2) & "C:\Program Files\Tailscale\tailscale.exe" funnel --bg 8787'
Write-Host '      (prints https://... - that is the permanent yard link)'
Write-Host ''
Read-Host 'Press Enter to finish'
