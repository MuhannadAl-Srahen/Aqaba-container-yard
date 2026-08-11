# ============================================================================
#  ساحة العقبة — تركيب السيرفر على جهاز المكتب
#  شغّل هذا الملف بزر يمين ← Run with PowerShell (لازم صلاحيات Administrator)
# ============================================================================
#  ماذا يفعل:
#   1. يتأكد من Node.js 24 (ينزّله وينصّبه إذا مش موجود)
#   2. ينسخ التطبيق إلى C:\AqabaYard\app  (البيانات منفصلة في C:\AqabaYard\data)
#   3. ينصّب حزم التشغيل (npm)
#   4. يسجّل التشغيل التلقائي مع إقلاع الجهاز (Scheduled Task باسم AqabaYard)
#   5. يفتح منفذ 8787 على جدار الحماية (للوصول من شبكة المكتب)
#   6. ينصّب Tailscale لرابط https مجاني من الإنترنت
#  إعادة تشغيل السكربت آمنة: يحدّث التطبيق ولا يلمس البيانات أبداً.
# ============================================================================

$ErrorActionPreference = 'Stop'
$Root   = 'C:\AqabaYard'
$AppDir = Join-Path $Root 'app'
$Here   = Split-Path -Parent $MyInvocation.MyCommand.Path

# ── 0. Administrator? ────────────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host ''
  Write-Host '  لازم تشغّل السكربت كـ Administrator:' -ForegroundColor Red
  Write-Host '  زر يمين على install.ps1 ← Run with PowerShell كمسؤول' -ForegroundColor Yellow
  Read-Host  '  اضغط Enter للخروج'
  exit 1
}

Write-Host ''
Write-Host '=== ساحة العقبة — التركيب بدأ ===' -ForegroundColor Cyan

# ── 1. Node.js 24 ────────────────────────────────────────────────────────────
$nodeOk = $false
try {
  $v = (& node -v) 2>$null
  if ($v -match '^v(\d+)\.' -and [int]$Matches[1] -ge 24) { $nodeOk = $true }
} catch {}
if ($nodeOk) {
  Write-Host "  [1/6] Node.js موجود ($v)" -ForegroundColor Green
} else {
  Write-Host '  [1/6] تنزيل Node.js 24 (دقيقة حسب النت)...' -ForegroundColor Yellow
  $msi = Join-Path $env:TEMP 'node24.msi'
  Invoke-WebRequest -Uri 'https://nodejs.org/dist/v24.13.0/node-v24.13.0-x64.msi' -OutFile $msi
  Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path','User')
  Write-Host '        انصّب Node.js' -ForegroundColor Green
}

# ── 2. إيقاف السيرفر القديم قبل أي نسخ ───────────────────────────────────────
# لازم يوقف الأول: ويندوز ما بيسمح باستبدال ملفات مفتوحة، وإذا نسخنا والسيرفر
# شغال بيفشل النسخ وبيضل النظام القديم شغال — وهاد بالضبط اللي بيخلي التحديث
# «ما ينزل».
Write-Host '  [2/7] إيقاف السيرفر القديم...' -ForegroundColor Yellow
try { Stop-ScheduledTask -TaskName 'AqabaYard' -ErrorAction Stop } catch {}
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*AqabaYard*' } |
  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }
# مهلة قصيرة حتى يطلق ويندوز الملفات فعلياً.
Start-Sleep -Seconds 3

# ── 3. نسخ التطبيق ───────────────────────────────────────────────────────────
Write-Host '  [3/7] نسخ التطبيق إلى C:\AqabaYard\app ...' -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $AppDir, (Join-Path $Root 'data'), (Join-Path $Root 'logs') | Out-Null
# التطبيق يُستبدل بالكامل عند التحديث؛ البيانات في data\ خارجه ولا تُلمس.
# node_modules مستثنى: هو ناتج npm مش جزء من الحزمة، ومسحه كل مرة يعني إعادة
# تنزيل 102 حزمة بلا داعٍ.
robocopy (Join-Path $Here 'app') $AppDir /MIR /XD node_modules /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) {
  throw 'robocopy failed — تأكد إنو ما في نسخة ثانية من السيرفر شغالة'
}
$global:LASTEXITCODE = 0

# ── 4. حزم التشغيل ───────────────────────────────────────────────────────────
Write-Host '  [4/7] تنصيب حزم التشغيل (npm)...' -ForegroundColor Yellow
Push-Location $AppDir
& npm install --omit=dev --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'npm install failed' }
Pop-Location
Write-Host '        تم' -ForegroundColor Green

# ── 5. التشغيل التلقائي ──────────────────────────────────────────────────────
Write-Host '  [5/7] تسجيل التشغيل التلقائي...' -ForegroundColor Yellow
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
Write-Host '        السيرفر صار يشتغل تلقائياً مع كل إقلاع' -ForegroundColor Green

# ── 6. جدار الحماية (شبكة المكتب) ────────────────────────────────────────────
Write-Host '  [6/7] فتح منفذ 8787 داخل الشبكة...' -ForegroundColor Yellow
try { Remove-NetFirewallRule -DisplayName 'AqabaYard' -ErrorAction Stop } catch {}
New-NetFirewallRule -DisplayName 'AqabaYard' -Direction Inbound -Protocol TCP `
  -LocalPort 8787 -Action Allow -Profile Private,Domain | Out-Null

# ── 7. Tailscale — رابط https من الإنترنت ───────────────────────────────────
$ts = 'C:\Program Files\Tailscale\tailscale.exe'
if (Test-Path $ts) {
  Write-Host '  [7/7] Tailscale موجود' -ForegroundColor Green
} else {
  Write-Host '  [7/7] تنزيل وتنصيب Tailscale...' -ForegroundColor Yellow
  $tsMsi = Join-Path $env:TEMP 'tailscale.msi'
  Invoke-WebRequest -Uri 'https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi' -OutFile $tsMsi
  Start-Process msiexec.exe -ArgumentList "/i `"$tsMsi`" /qn /norestart" -Wait
  Start-Sleep -Seconds 5
}

# ── فحص أن السيرفر رد ────────────────────────────────────────────────────────
Start-Sleep -Seconds 4
try {
  $boot = Invoke-RestMethod -Uri 'http://localhost:8787/api/boot' -TimeoutSec 15
  Write-Host ''
  Write-Host '=== السيرفر شغال ===' -ForegroundColor Green
} catch {
  Write-Host ''
  Write-Host '!! السيرفر ما رد بعد — شوف اللوغ: C:\AqabaYard\logs\server.log' -ForegroundColor Red
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' } |
  Select-Object -First 1).IPAddress

Write-Host ''
Write-Host '  من هذا الجهاز:      http://localhost:8787' -ForegroundColor Cyan
Write-Host "  من شبكة المكتب:     http://${ip}:8787" -ForegroundColor Cyan
Write-Host ''
Write-Host '  باقي خطوتين لرابط الإنترنت (مرة واحدة):' -ForegroundColor Yellow
Write-Host '   1) & "C:\Program Files\Tailscale\tailscale.exe" up'
Write-Host '      (يفتح المتصفح — سجّل دخول بحساب Google)'
Write-Host '   2) & "C:\Program Files\Tailscale\tailscale.exe" funnel --bg 8787'
Write-Host '      (يطبع رابط https://... — هذا رابط الساحة الدائم، انسخه للشباب)'
Write-Host ''
Read-Host 'اضغط Enter للإنهاء'
