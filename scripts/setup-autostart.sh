#!/bin/bash
set -Eeuo pipefail

if [[ $# -gt 1 || ($# -eq 1 && $1 != "--services-only") ]]; then
    echo "用法：bash scripts/setup-autostart.sh [--services-only]" >&2
    exit 2
fi

cd "$(dirname "$0")/.."
command -v systemctl >/dev/null || { echo "需要 Ubuntu EC2 的 systemd 環境。" >&2; exit 1; }

# Validate the proxy before enabling services; leave invalid configuration visible.
sudo nginx -t
sudo systemctl enable --now containerd.service docker.service nginx.service
for service in containerd docker nginx; do
    sudo systemctl is-enabled --quiet "$service.service"
    sudo systemctl is-active --quiet "$service.service"
done

if [[ ${1:-} != "--services-only" ]]; then
    # Apply compose.yaml's restart policy and resume a manually stopped container.
    # Use the existing image: boot configuration never needs a rebuild or git pull.
    sudo docker compose up -d --no-build --wait --wait-timeout 180 app
    sudo docker compose ps app
    echo "網站健康檢查通過。"
fi
echo "已設定 Docker、containerd 與 Nginx 開機自動啟動。"
echo "網站容器由 compose.yaml 的 restart: unless-stopped 自動恢復。"
