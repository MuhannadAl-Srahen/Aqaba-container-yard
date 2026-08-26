#!/usr/bin/env bash
# ساحة العقبة — تجهيز سيرفر سحابي (أوبونتو 24.04) بأمر واحد.
#
# قبل التشغيل: ارفع مجلد التطبيق إلى /opt/aqaba-yard (المطلوب: dist وsrc
# وpackage.json وdeploy — بلا node_modules، فالخادم يثبّتها لنفسه).
#
# التشغيل، بصلاحية root، مع اسم النطاق الذي يشير إلى IP هذا السيرفر:
#   bash /opt/aqaba-yard/deploy/cloud/cloud-setup.sh yard.example.com
# بلا نطاق (تجربة على المنفذ 8787 مباشرة): شغّله بلا وسيط.
#
# الأمر يُعاد تشغيله بأمان: كل خطوة تتحقق قبل أن تعمل.
set -euo pipefail

DOMAIN="${1:-}"
APP=/opt/aqaba-yard
SERVICE_USER=aqaba

# أوبونتو يشغّل تحديثاته التلقائية في الخلفية فيمسك قفل التثبيت دقائق، وأي
# تثبيت هنا كان يفشل في اللحظة نفسها بدل أن ينتظره. هذه تنتظر خمس دقائق.
export DEBIAN_FRONTEND=noninteractive
apt_get() { command apt-get -o DPkg::Lock::Timeout=300 "$@"; }

echo "== Node 24 =="
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt_get install -y nodejs
fi

echo "== ذاكرة احتياطية (swap) =="
# قرص السحابة يأتي بلا swap. الاسترجاع يحمّل ملف النسخة كاملاً في الذاكرة،
# وطباعة PDF تفتح متصفحاً — والاثنان معاً على ذاكرة صغيرة يقتلان الخدمة.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== متصفح الطباعة (تصدير PDF) =="
# زر «تصدير PDF» في الكشوف يطبع الورقة بمحرك متصفح حقيقي على السيرفر.
# بلا متصفح مثبّت يفشل الزر وحده بينما يبدو النظام سليماً.
if [ ! -x /opt/google/chrome/chrome ]; then
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
    | gpg --dearmor --yes -o /usr/share/keyrings/google-chrome.gpg
  echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
    > /etc/apt/sources.list.d/google-chrome.list
  apt_get update
  apt_get install -y google-chrome-stable
fi

echo "== التطبيق وقاعدة البيانات =="
mkdir -p "$APP/data"
cd "$APP"
npm install --omit=dev

echo "== مستخدم الخدمة =="
# النظام لا يعمل بصلاحية root: خادم على الإنترنت العام يفتح متصفحاً، وصندوق
# أمان المتصفح نفسه يرفض العمل تحت root. مستخدم خاص يحلّ الاثنين معاً.
id -u "$SERVICE_USER" >/dev/null 2>&1 \
  || useradd --system --home "$APP" --shell /usr/sbin/nologin "$SERVICE_USER"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP"

echo "== الخدمة الدائمة =="
cp "$APP/deploy/cloud/aqaba-yard.service" /etc/systemd/system/aqaba-yard.service
systemctl daemon-reload
systemctl enable aqaba-yard
systemctl restart aqaba-yard

if [ -n "$DOMAIN" ]; then
  echo "== HTTPS عبر Caddy على $DOMAIN =="
  # التثبيت مرة واحدة. إعادته في كل رفعة كانت تجرّ السكربت إلى قفل apt بلا
  # حاجة، فيتوقف بعد أن يكون التطبيق قد رُفع وشُغّل فعلاً — فيبدو الرفع
  # فاشلاً وهو ناجح.
  if ! command -v caddy >/dev/null 2>&1; then
    apt_get install -y debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      | tee /etc/apt/sources.list.d/caddy-stable.list
    apt_get update
    apt_get install -y caddy
  fi
  # العنوان قد يتغيّر فالملف يُكتب في كل مرة، لكن Caddy لا يُعاد تشغيله إلا
  # إن تغيّر فعلاً — فلا ينقطع الموقع في كل تحديث بلا سبب.
  sed "s/{{DOMAIN}}/$DOMAIN/" "$APP/deploy/cloud/Caddyfile" > /tmp/Caddyfile.new
  if cmp -s /tmp/Caddyfile.new /etc/caddy/Caddyfile 2>/dev/null; then
    rm -f /tmp/Caddyfile.new
  else
    mv /tmp/Caddyfile.new /etc/caddy/Caddyfile
    systemctl restart caddy
  fi
fi

echo "== الجدار: SSH و80/443 فقط — منفذ التطبيق يبقى داخلياً =="
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable

echo ""
echo "== فحص أخير =="
sleep 2
systemctl is-active --quiet aqaba-yard \
  && echo "الخدمة تعمل." \
  || { echo "الخدمة لا تعمل. اقرأ السبب: journalctl -u aqaba-yard -n 50"; exit 1; }

if [ -n "$DOMAIN" ]; then
  echo "تم. افتح: https://$DOMAIN — أول فتح يطلب تهيئة كلمة المالك."
else
  echo "تم بلا نطاق. للتجربة: ufw allow 8787 ثم افتح http://IP:8787"
fi
