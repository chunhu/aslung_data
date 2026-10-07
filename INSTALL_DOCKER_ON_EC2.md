# 在現有 EC2 上安裝 Docker 與切換部署教學

如果您的 EC2 伺服器目前沒有安裝 Docker（例如原先使用 PM2 直接執行），可以隨時事後安裝 Docker，這完全**不會影響或刪除**您 EC2 上現有的專案檔案與資料。

將專案改由 Docker 運行，能幫您將 Node.js 版本與套件環境完全隔離，後續管理與維護會更輕鬆。

請依序執行以下 3 個步驟來完成環境的切換：

---

## 步驟 1：安裝 Docker 與 Docker Compose

請透過 SSH 連線進入您的 EC2，然後依序貼上並執行以下指令。這是 Docker 官方提供的一鍵安裝腳本，適合 Ubuntu 等 Linux 系統：

```bash
# 1. 下載並執行 Docker 官方的一鍵安裝腳本
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# 2. 確認是否安裝成功（有印出版本號即代表成功）
sudo docker version
sudo docker compose version

# 3. (選用) 將當前使用者加入 docker 群組，以後執行 docker 就不用加 sudo
sudo usermod -aG docker $USER
```

---

## 步驟 2：停用原有的 PM2 服務（釋放 Port）

如果您目前 EC2 上已經有使用 PM2 在跑這個專案，我們需要先把它停掉，把 `3000` 埠讓出來給 Docker 容器使用：

```bash
# 停止並刪除原有的 pm2 服務
pm2 stop all
pm2 delete all

# 如果不再需要 PM2，可以取消開機自動啟動
pm2 unstartup
```

---

## 步驟 3：使用自動化腳本一鍵部署

Docker 環境準備好、Port 也空出來之後，您就可以進入專案資料夾，直接執行自動部署腳本了：

```bash
# 進入您的專案目錄 (請換成您實際的專案路徑，例如 ~/aslung_data)
cd ~/aslung_data

# 確保腳本有執行權限
chmod +x scripts/deploy.sh

# 開始自動部署
./scripts/deploy.sh
```

執行後，Docker 就會在背後自動幫您拉取最新的環境映像檔、安裝 pnpm 依賴套件並啟動服務。

未來有程式碼更新時，您也只需要再次執行 `./scripts/deploy.sh` 即可自動更新與重啟！
