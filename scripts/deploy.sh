#!/bin/bash

# --- START TIME ---
START_TIME=$(date +%s)
echo "--- 開始執行部署作業: $(date +"%Y-%m-%d %H:%M:%S") ---"

# 進入專案根目錄 (腳本在 scripts 子目錄中)
cd "$(dirname "$0")/.." || exit

echo "--- 正在檢查 GitHub 更新 ---"
git fetch origin main

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
    echo "目前已是最新版本 ($LOCAL)。"
    read -p "是否要強制重新建置與重啟服務 (Force Rebuild)? (y/n) " choice
    case "$choice" in 
      y|Y ) echo "開始強制重布...";;
      * ) echo "已取消"; exit 0;;
    esac
else
    echo "發現新版本 ($REMOTE)。"
    echo "本地版本: $LOCAL"
    echo "開始自動更新與部署..."
fi

echo "--- 正在從 GitHub 拉取最新程式碼 ---"
git pull origin main

echo "--- 正在進行專案建置與重啟服務 ---"
# 備註：本專案使用 Docker Compose 進行部署，容器內部會自動執行 pnpm install 與 next build。
# 資料庫為原生 SQLite，啟動時會自動確保 Table 結構 (無需 Prisma generate/db push)。
# 若您未使用 Docker 而是直接使用 PM2，可將以下這行改為 pnpm install && pnpm build && pm2 restart all
sudo docker compose up -d --build

# --- END TIME ---
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo "--- 部署完成！ ---"
echo "完成時間: $(date +"%Y-%m-%d %H:%M:%S")"
echo "總耗時: $DURATION 秒"
