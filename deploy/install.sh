#!/usr/bin/env bash
# Installe le collecteur sur un serveur Debian 12 / Ubuntu 24.04 neuf.
# À lancer en root depuis la copie du projet : bash deploy/install.sh
# Relançable sans risque pour mettre à jour le code (la base Supabase et la config ne sont pas touchées).
set -euo pipefail

APP_DIR=/opt/poll-collector
DATA_DIR=/var/lib/poll-collector
ENV_FILE=/etc/poll-collector.env
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

apt-get update -q
apt-get install -y -q python3 python3-venv cron util-linux rsync

id collector >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin collector
mkdir -p "$APP_DIR" "$DATA_DIR/logs"

rsync -a --delete --exclude .venv --exclude data --exclude __pycache__ --exclude .env "$SRC_DIR/" "$APP_DIR/"
python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install -q -r "$APP_DIR/requirements.txt"
chown -R collector:collector "$DATA_DIR"

# Config secrète : créée une seule fois depuis le modèle, à remplir à la main.
if [ ! -f "$ENV_FILE" ]; then
  install -m 640 -o root -g collector "$APP_DIR/.env.example" "$ENV_FILE"
fi
if grep -q "MOT_DE_PASSE" "$ENV_FILE"; then
  echo "À FAIRE : mets la vraie chaîne de connexion Supabase dans $ENV_FILE, puis relance ce script."
  exit 1
fi

run() { (cd "$APP_DIR" && runuser -u collector -- env COLLECTOR_ENV="$ENV_FILE" COLLECTOR_DATA="$DATA_DIR" .venv/bin/python -m collector "$@"); }

echo "== Accès aux sources depuis ce serveur"
if ! run check; then
  echo "ATTENTION : une source est injoignable. Si c'est Polymarket, choisis un serveur dans un autre pays."
  exit 1
fi

echo "== Première collecte complète (quelques minutes)"
run all

install -m 644 "$APP_DIR/deploy/crontab" /etc/cron.d/poll-collector
systemctl enable --now cron >/dev/null 2>&1 || true
echo "Installé. Collectes planifiées dans /etc/cron.d/poll-collector — logs : $DATA_DIR/logs/"
