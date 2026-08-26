#!/usr/bin/env bash
# ساحة العقبة — تجهيز سيرفر سحابي (أوبونتو 24.04) بأمر واحد.
#
# قبل التشغيل: ارفع مجلد التطبيق إلى /opt/aqaba-yard (المطلوب: dist وsrc
# وpackage.json وdeploy — بلا node_modules، فالخادم يثبّتها لنفسه).
#
# التشغيل، بصلاحية root، مع اسم النطاق الذي يشير إلى IP هذا السيرفر:
#   bash /opt/aqaba-yard/deploy/cloud/cloud-setup.sh yard.example.com
# بلا نطاق (تجربة على المنفذ 8787 مباشرة): شغّله بلا وسيط.
set -euo pipefail

DOMAIN="${1:-}"
APP=/opt/aqaba-yard

echo "== Node 24 =="
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

echo "== التطبيق وقاعدة البيانات =="
mkdir -p "$APP/data"
cd "$APP"
npm install --omit=dev

echo "== الخدمة الدائمة =="
cp "$APP/deploy/cloud/aqaba-yard.service" /etc/systemd/system/aqaba-yard.service
systemctl daemon-reload
systemctl enable --now aqaba-yard

if [ -n "$DOMAIN" ]; then
  echo "== HTTPS عبر Caddy على $DOMAIN =="
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
  sed "s/{{DOMAIN}}/$DOMAIN/" "$APP/deploy/cloud/Caddyfile" > /etc/caddy/Caddyfile
  systemctl restart caddy
fi

echo "== الجدار: SSH و80/443 فقط — منفذ التطبيق يبقى داخلياً =="
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable

echo ""
if [ -n "$DOMAIN" ]; then
  echo "تم. افتح: https://$DOMAIN — أول فتح يطلب تهيئة كلمة المالك."
else
  echo "تم بلا نطاق. للتجربة: ufw allow 8787 ثم افتح http://IP:8787"
fi
