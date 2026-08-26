<#
  ساحة العقبة — رفع النظام إلى السيرفر السحابي من ويندوز بأمر واحد.

  التشغيل من مجلد التطبيق (الذي فيه dist و src و deploy و package.json):

      powershell -ExecutionPolicy Bypass -File deploy\cloud\deploy.ps1

  أو بعنوان ونطاق آخرين:

      ... -File deploy\cloud\deploy.ps1 -Server 1.2.3.4 -Domain example.com

  يطلب كلمة سر root مرة واحدة فقط في أول تشغيل (ليضع مفتاح الدخول)، ثم لا
  يطلبها بعد ذلك أبداً — فالتحديثات لاحقاً تصير بنفس الأمر بلا كلمة سر.
  ويُعاد تشغيله بأمان في أي وقت: كل خطوة تتحقق قبل أن تعمل.
#>
[CmdletBinding()]
param(
  [string]$Server = '88.223.95.144',
  [string]$Domain = 'aqaba-yard.systems',
  [string]$User = 'root',
  [string]$AppPath = '',
  # تخطّي فحص النطاق (لرفع بلا نطاق، أو إن كنت تعرف ما تفعل).
  [switch]$SkipDnsCheck
)

$ErrorActionPreference = 'Stop'
$remote = "${User}@${Server}"
# accept-new: أول اتصال لا يسأل سؤال المفتاح، لكن تغيّر مفتاح السيرفر لاحقاً
# يبقى يُرفض — وهو ما يحمي من انتحال السيرفر.
$sshOpts = @('-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15')

function Say($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "   $text" -ForegroundColor Green }
function Warn($text) { Write-Host "   $text" -ForegroundColor Yellow }
function Die($text) { Write-Host "`nتوقف: $text" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------- مجلد التطبيق ----
Say 'مجلد التطبيق'
if ($AppPath -eq '') {
  # السكربت يعيش في <app>\deploy\cloud\ — فالمجلد فوقه بمستويين.
  $AppPath = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}
if (-not (Test-Path $AppPath)) { Die "لا يوجد مجلد بهذا المسار: $AppPath" }

$needed = @('dist', 'src', 'deploy', 'package.json')
foreach ($item in $needed) {
  if (-not (Test-Path (Join-Path $AppPath $item))) {
    Die "ناقص «$item» في $AppPath. تأكد أنك تشغّل السكربت من مجلد التطبيق الكامل."
  }
}
Ok $AppPath

# --------------------------------------------------------------- الأدوات ----
Say 'أدوات ويندوز'
foreach ($tool in @('ssh', 'scp', 'ssh-keygen')) {
  if ($null -eq (Get-Command $tool -ErrorAction SilentlyContinue)) {
    Die "الأمر «$tool» غير موجود. فعّل OpenSSH Client من: الإعدادات ← التطبيقات ← الميزات الاختيارية."
  }
}
Ok 'ssh و scp جاهزان'

# ----------------------------------------------------------------- النطاق ----
if (-not $SkipDnsCheck -and $Domain -ne '') {
  Say "فحص النطاق $Domain"
  try {
    $a = Resolve-DnsName -Name $Domain -Type A -DnsOnly -ErrorAction Stop |
      Where-Object { $_.QueryType -eq 'A' }
  } catch { $a = $null }
  if ($null -eq $a) {
    Die "النطاق $Domain لا يشير إلى أي عنوان بعد. أضف سجل A يشير إلى $Server وانتظر دقائق."
  }
  $addresses = @($a | ForEach-Object { $_.IPAddress })
  if ($addresses -notcontains $Server) {
    Die "سجل A للنطاق يشير إلى $($addresses -join ', ') لا إلى $Server. صحّحه أولاً."
  }
  Ok "سجل A يشير إلى $Server"

  # سجل AAAA يقتل الشهادة بصمت: التحقق من ليتس-إنكربت يفضّل IPv6، فيذهب إلى
  # ذلك العنوان لا إلى سيرفرك، فيفشل إصدار الشهادة ويبقى الموقع بلا https.
  try {
    $aaaa = Resolve-DnsName -Name $Domain -Type AAAA -DnsOnly -ErrorAction Stop |
      Where-Object { $_.QueryType -eq 'AAAA' }
  } catch { $aaaa = $null }
  if ($null -ne $aaaa) {
    $v6 = @($aaaa | ForEach-Object { $_.IPAddress }) -join ', '
    Die @"
النطاق يحمل سجل AAAA يشير إلى $v6 — وهذا ليس سيرفرك.
الشهادة الآمنة (https) ستفشل لأن التحقق يفضّل IPv6 فيصل إلى الجهاز الخطأ.

الحل: من لوحة Hostinger ← Domains ← نطاقك ← DNS / Nameservers،
احذف سطر AAAA (سلة المهملات الحمراء بجانبه)، وانتظر دقائق، ثم أعد
تشغيل هذا السكربت.
"@
  }
  Ok 'لا يوجد سجل AAAA يعارض — الطريق سالك للشهادة'
}

# ------------------------------------------------------- مفتاح الدخول ----
Say 'مفتاح الدخول (حتى لا تُسأل كلمة السر كل مرة)'
$keyPath = Join-Path $HOME '.ssh\id_ed25519'
$pubPath = "$keyPath.pub"
if (-not (Test-Path $pubPath)) {
  $sshDir = Split-Path $keyPath
  if (-not (Test-Path $sshDir)) { New-Item -ItemType Directory -Path $sshDir | Out-Null }
  Warn 'لا يوجد مفتاح على جهازك — يُنشأ الآن'
  & ssh-keygen -t ed25519 -N '""' -f $keyPath -C 'aqaba-yard-deploy' | Out-Null
}

& ssh @sshOpts -o BatchMode=yes $remote 'true' 2>$null
if ($LASTEXITCODE -eq 0) {
  Ok 'المفتاح يعمل — لن تُطلب كلمة السر'
} else {
  Warn 'أول مرة: اكتب كلمة سر root حين تُطلب (الكتابة لا تظهر — هذا طبيعي)'
  Get-Content $pubPath | & ssh @sshOpts $remote 'mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys; chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys'
  if ($LASTEXITCODE -ne 0) { Die 'تعذّر الدخول. تأكد من عنوان السيرفر وكلمة سر root.' }
  & ssh @sshOpts -o BatchMode=yes $remote 'true' 2>$null
  if ($LASTEXITCODE -ne 0) { Die 'وُضع المفتاح لكنه لا يعمل. أعد تشغيل السكربت.' }
  Ok 'تم وضع المفتاح — لن تُطلب كلمة السر بعد اليوم'
}

# ------------------------------------------------------------ رفع الملفات ----
Say 'رفع ملفات التطبيق إلى /opt/aqaba-yard'
& ssh @sshOpts $remote 'mkdir -p /opt/aqaba-yard'
if ($LASTEXITCODE -ne 0) { Die 'تعذّر إنشاء المجلد على السيرفر.' }

Push-Location $AppPath
try {
  # الملفات المطلوبة وحدها — بلا node_modules، فالسيرفر يثبّتها لنفسه
  # ونسخ ويندوز لا تعمل على لينكس أصلاً.
  & scp -r @sshOpts dist src deploy package.json "${remote}:/opt/aqaba-yard/"
  $uploaded = $LASTEXITCODE
} finally {
  Pop-Location
}
if ($uploaded -ne 0) { Die 'فشل رفع الملفات.' }
Ok 'رُفعت dist و src و deploy و package.json'

# --------------------------------------------------------------- التجهيز ----
Say 'تجهيز السيرفر (يأخذ دقائق: Node ومتصفح الطباعة والخدمة والشهادة)'
Warn 'اتركه يعمل ولا تغلق النافذة'
& ssh @sshOpts $remote "bash /opt/aqaba-yard/deploy/cloud/cloud-setup.sh $Domain"
if ($LASTEXITCODE -ne 0) {
  Die @"
فشل التجهيز. اقرأ السبب بهذا الأمر ثم أرسل لي ما يظهر:
    ssh $remote "journalctl -u aqaba-yard -n 50"
"@
}

# ------------------------------------------------------------------ فحص ----
Say 'فحص أخير'
& ssh @sshOpts $remote 'systemctl is-active --quiet aqaba-yard'
if ($LASTEXITCODE -ne 0) { Die 'الخدمة لا تعمل على السيرفر.' }
Ok 'الخدمة تعمل'

if ($Domain -ne '') {
  $url = "https://$Domain"
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 25
    Ok "الموقع يستجيب: $($response.StatusCode)"
  } catch {
    Warn "الموقع لم يستجب بعد — الشهادة قد تحتاج دقيقة. جرّب فتح $url في المتصفح."
  }
  Write-Host "`nتم. افتح: $url" -ForegroundColor Green
  Write-Host "أول فتح يطلب تهيئة كلمة المالك، ثم استرجع نسخة المكتب من: أدوات التدريب ← الاسترجاع.`n"
} else {
  Write-Host "`nتم بلا نطاق. للتجربة: ssh $remote 'ufw allow 8787' ثم افتح http://${Server}:8787`n" -ForegroundColor Green
}
