#!/bin/bash
set -Eeuo pipefail
DEPLOY_STARTED_AT=$(date +%s)
CURRENT_STAGE="初始化"
STAGE_NAMES=()
STAGE_SECONDS=()

on_error() {
    local exit_code=$1
    echo "--- 部署失敗：${CURRENT_STAGE}（結束碼 ${exit_code}）---" >&2
    echo "已耗時：$(($(date +%s) - DEPLOY_STARTED_AT)) 秒；請查看上方錯誤，尚未完成部署。" >&2
    exit "$exit_code"
}
trap 'on_error "$?"' ERR

run_stage() {
    CURRENT_STAGE=$1
    shift
    local stage_started elapsed
    stage_started=$(date +%s)
    echo "--- ${CURRENT_STAGE} ---"
    "$@"
    elapsed=$(($(date +%s) - stage_started))
    STAGE_NAMES+=("$CURRENT_STAGE")
    STAGE_SECONDS+=("$elapsed")
    echo "[階段耗時] ${CURRENT_STAGE}：${elapsed} 秒"
}

FORCE_REBUILD=0
if [[ $# -gt 1 || ($# -eq 1 && $1 != "--force") ]]; then
    echo "用法：bash scripts/deploy.sh [--force]" >&2
    exit 2
fi
if [[ ${1:-} == "--force" ]]; then FORCE_REBUILD=1; fi

echo "--- 開始執行部署作業：$(date +"%Y-%m-%d %H:%M:%S") ---"
cd "$(dirname "$0")/.."
run_stage "切換至 main 分支" git switch main
run_stage "設定開機自動啟動" bash scripts/setup-autostart.sh --services-only
run_stage "檢查 GitHub 更新" git fetch origin main
LOCAL_COMMIT=$(git rev-parse HEAD)
REMOTE_COMMIT=$(git rev-parse origin/main)

if [[ "$LOCAL_COMMIT" == "$REMOTE_COMMIT" && "$FORCE_REBUILD" -eq 0 ]]; then
    echo "目前已是最新版本（${LOCAL_COMMIT}）。"
    if [[ ! -t 0 ]]; then
        echo "沒有執行建置。需要重新建置時請加 --force（仍會使用快取）。"
        exit 0
    fi
    read -r -p "是否重新建置與重啟服務？(y/n) " choice
    case "$choice" in y|Y) ;; *) echo "已取消"; exit 0 ;; esac
fi

# Refuse a divergent history instead of creating a deployment-time merge.
run_stage "更新程式碼" git pull --ff-only origin main
# BuildKit plain output exposes COPY, compilation, image export and cache hits.
run_stage "Docker 映像建置" sudo docker compose --progress plain build app
# Keep the current container running while building, then wait for the new
# container's Compose healthcheck before reporting a successful deployment.
run_stage "容器更新與健康檢查" sudo docker compose up -d --no-build --wait --wait-timeout 180 app

echo "--- 部署完成，服務健康檢查通過 ---"
for index in "${!STAGE_NAMES[@]}"; do
    printf '  %s：%s 秒\n' "${STAGE_NAMES[$index]}" "${STAGE_SECONDS[$index]}"
done
echo "完成時間：$(date +"%Y-%m-%d %H:%M:%S")"
echo "總耗時：$(($(date +%s) - DEPLOY_STARTED_AT)) 秒"
