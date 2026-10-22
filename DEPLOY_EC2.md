# AWS EC2 部署指南

更新：2026-10-22。使用者與管理功能另見 [中文完整手冊](docs/ASLUNG_Website_User_Manual_ZH.md)／[English manual](docs/ASLUNG_Website_User_Manual_EN.md)。API 範例請見 `docs/ASLUNG_API_User_Guide_ZH.md` 與 `_EN.md`。

本專案使用 **Ubuntu 24.04 LTS**、**Docker Engine / Compose**、**Nginx**，並強烈建議配置正式網域與 HTTPS，以符合安全性最佳實踐。

建置建議預留至少 4 GB 記憶體與 10 GB 可用磁碟空間（非強制規格）。
如果您現有的 EC2 已經運行其他網站或資料庫，只需保留原有資料，將本系統綁定獨立網域即可共存。

---

## 1. 網路與基本環境設定

1. **DNS 設定**：將您的網域 A 記錄（例如 `aslung.your-domain.com`）指向 EC2 的公開固定 IP（建議使用 AWS Elastic IP）。
2. **Security Group 防火牆**：
   * SSH 實際使用的 TCP 埠（預設 22；若已改為 2222 則使用 2222）：僅允許管理員的 IP 存取。
   * HTTP/HTTPS `TCP 80` 及 `TCP 443`：依機構政策開放需要的來源；公眾服務才開放全球。
   * 系統內部運行於 `127.0.0.1:3000`，**不需要**對外開放 3000 埠。
3. **安裝 Docker 與 Nginx**：
   依據官方指示安裝 Docker Engine 與 Docker Compose，並安裝 Nginx 與 Unzip：
   ```bash
   sudo apt update
   sudo apt install -y nginx unzip
   # 確認 Docker 已安裝
   sudo docker version
   sudo docker compose version
   ```

---

## 2. 上傳部署包與設定環境變數

將專案程式碼上傳至 EC2（例如透過 Git Clone 或是打包成 ZIP 透過 SCP 上傳）：

```bash
# 建立專案目錄並進入
mkdir -p ~/aslung-deployment
cd ~/aslung-deployment

# 從 GitHub 拉取最新程式碼 (或上傳檔案)
git clone --branch codex/calibration-management https://github.com/chunhu/aslung_data.git aslung_data
cd aslung_data

# 建立並編輯設定檔
cp .env.example .env
chmod 600 .env
nano .env
```

**修改 `.env` 範例：**
```dotenv
# 您的正式網域，必須與您申請的網址完全相符 (不含結尾斜線)
APP_ORIGIN=https://aslung.your-domain.com

DATABASE_PATH=/app/data/aslung.sqlite
BACKUP_PATH=/app/backups

# ASLUNG 原始量測來源：既有 MySQL，使用唯讀帳號
MYSQL_HOST=your-database-host
MYSQL_USER=your-readonly-user
MYSQL_PASSWORD=your-secret
MYSQL_DATABASE=your-database

# local 或 s3，兩種資料可獨立選擇儲存方式
CALIBRATION_STORAGE=local
HOBO_STORAGE=local
AWS_REGION=ap-northeast-1
S3_BUCKET=your-bucket
LICOR_API_TOKEN=your-private-token
HOBO_API_INTERVAL_MS=15000
HOBO_MONTH_PAUSE_MS=60000

NEXT_TELEMETRY_DISABLED=1
```

---

## 3. 建置服務與建立初始管理員

```bash
# 在背景啟動並建立容器
sudo docker compose --profile calibration up -d --build

# 確認服務運行狀態
sudo docker compose --profile calibration ps -a
curl http://127.0.0.1:3000/api/health
# 若回傳 {"status":"ok"} 代表啟動成功

# 建立首位管理員帳號
sudo docker compose exec app node scripts/create-admin.mjs
# 系統將提示您輸入：管理員帳號(暱稱)、Email(選填)、姓名與密碼
```

---

## 4. 設定 Nginx 與申請 SSL 憑證 (HTTPS)

為了安全連線與 Cookie 功能（系統使用 Secure Cookie），強烈建議設定 HTTPS：

1. **設定 Nginx**：
   ```bash
   sudo cp deploy/nginx.conf /etc/nginx/sites-available/aslung
   sudo ln -s /etc/nginx/sites-available/aslung /etc/nginx/sites-enabled/aslung
   
   # 使用 nano 修改設定檔內的網域 (server_name) 為您的實際網域
   sudo nano /etc/nginx/sites-available/aslung
   
   sudo nginx -t
   sudo systemctl reload nginx
   ```

2. **使用 Certbot 申請憑證**：
   ```bash
   # 安裝 certbot
   sudo snap install --classic certbot
   sudo ln -s /snap/bin/certbot /usr/bin/certbot
   
   # 申請並自動配置 Nginx
   sudo certbot --nginx -d aslung.your-domain.com
   ```

> 憑證申請完成後，即可直接透過 `https://aslung.your-domain.com` 使用方才建立的管理員帳號進行登入。

---

### EC2 重新開機後自動啟動網站

完成 Docker、Nginx 與網站設定後，在 EC2 專案根目錄執行一次：

```bash
bash scripts/setup-autostart.sh
```

腳本先檢查 Nginx 設定，再啟用並啟動 Docker、containerd、Nginx 的 systemd 服務，最後使用現有映像啟動網站並等待健康檢查。需要現有 Docker 映像與 `.env`；不下載程式碼、不重新建置，也不更改網域設定。

之後開機由 systemd 啟動 Docker / Nginx，Docker 依 `compose.yaml` 的 `restart: unless-stopped` 恢復網站。**不需要在每次開機執行部署腳本。** 若曾使用 `docker compose stop` 手動停止容器，它會保持停止；重新執行上述設定腳本即可恢復。若使用 `docker compose down` 移除容器，也需重新執行上述腳本建立容器。

`scripts/deploy.sh` 每次執行時也會設定這些服務開機啟動，即使沒有新版本而略過建置仍會執行。若要恢復已停止的網站，請直接執行 `setup-autostart.sh`。

設定後可在維護時間重新啟動 EC2，再用以下指令確認：

```bash
systemctl is-enabled docker nginx
systemctl is-active docker nginx
sudo docker compose ps -a
curl --fail http://127.0.0.1:3000/api/health
```

預期服務為 `enabled` / `active`，容器為 `healthy`，健康檢查回傳 `{"status":"ok"}`；最後以正式 HTTPS 網址確認網站可使用。失敗時查看 `sudo docker compose logs --tail=80 app` 及 `sudo journalctl -u docker -u nginx -b --no-pager -n 80`。

## 5. 後續設定與資料來源驗證

登入系統後，您可以開始進行下列管理：
1. **ASLUNG ID 管理**：建立對應的設備 ID 供授權使用。
2. **會員管理**：建立其他會員帳號（包含帳號暱稱與初始密碼），並將帳密交給對方。
3. **資料授權**：指派特定會員可查詢的 ASLUNG ID 及時間範圍。

ASLUNG 已由後端直接查詢 MySQL，無須另建舊版文件中的量測代理 API。確認 MySQL 網路可達、帳密正確及 `rawdata` 結構，再用一台設備一天的期間驗證原始資料。SMTP 在網站管理頁設定；自助註冊需要驗證信及管理員審核，核准後仍須配置資料授權。

HOBO 另需 `LICOR_API_TOKEN`。使用 S3 時，將讀寫政策及清除補充政策新增至目前 EC2 Role，依實際桶名替換政策範本資源；保留原有讀寫權限。範本為 `scripts/iam-calibration-cleanup.json`、`scripts/iam-hobo-cleanup.json`。先驗證一台一天的同步、查詢與下載，再執行歷史匯入。校正與 HOBO 排程沿用資料庫設定，啟動 worker 不代表已啟用排程。

變更 `.env` 後需重新建立容器，單純 restart 不會載入新的容器環境變數：
```bash
sudo docker compose --profile calibration up -d --force-recreate
```

---

## 6. 資料庫備份與還原機制

**建立備份**（產生不阻斷服務的熱備份）：
```bash
# 讓系統建立一個安全的 SQLite 備份檔
sudo docker compose exec app node scripts/backup.mjs

# 將備份拉出至本機目錄以利留存或傳送至 S3
mkdir -p ~/aslung-backups
sudo docker compose cp app:/app/backups/. ~/aslung-backups/
```

**還原備份**（會覆蓋目前設定與紀錄，先另存目前備份並確認 restore.sqlite 是正確且完整的 SQLite 備份）：

停止網站及 worker 後才能覆蓋。還原命令只處理 SQLite；一般上傳檔案、本機校正成果、MySQL 與 S3 需另外備份與一致性還原。刪除測試資料前建立的 SQLite 備份不會恢復已永久刪除的 S3 物件。
```bash
sudo docker compose --profile calibration stop app calibration-worker
# 將 restore.sqlite 覆蓋現有資料庫並清除暫存日誌
sudo docker compose run --rm --no-deps -u root --entrypoint sh -v "$PWD/restore.sqlite:/restore.sqlite:ro" app -c 'cp /restore.sqlite /app/data/aslung.sqlite && rm -f /app/data/aslung.sqlite-wal /app/data/aslung.sqlite-shm && chown 1001:1001 /app/data/aslung.sqlite && chmod 600 /app/data/aslung.sqlite'
sudo docker compose --profile calibration up -d
```

---

## 7. 疑難排解與實用指令

### 告警排程與重複寄信防護

告警排程在 Next.js 伺服器啟動時註冊，每 30 秒判斷是否到達設定的檢查時間；不需要開啟管理員網頁。排程與手動檢查共用 SQLite 執行鎖，執行期間持續續期；程序異常中止後，鎖最多約 2 分鐘可回收。手動檢查遇到執行中的批次會顯示略過提示。

寄信前先記錄本次檢查時間，避免程序重啟或 SMTP 回覆不明時，下一次輪詢立即重寄同批通知。寄送失敗不在同一週期自動重試；依下次設定的排程再次檢查，或確認日誌後手動執行。若程序在寄送途中中止，部分收件人可能未收到，該次日誌可能保留待處理狀態。郵件會附檢查編號與判定時間供比對；設備持續離線時，後續排程仍會提醒。

資料庫成功查詢但無紀錄的設備仍算未上傳；查詢失敗則記為「狀態未知」，不計入斷線數，也不寄設備斷線信。檢查摘要會列出查詢失敗數，設備日誌列出原因；應先排查資料庫連線。這些防護適用本專案單一 EC2、共用同一 SQLite 持久磁碟區的部署。

* **忘記管理員密碼**：
  如果無法登入，可進入伺服器重設密碼（這將強制登出該帳號的所有現有連線）：
  ```bash
  sudo docker compose exec app node scripts/reset-password.mjs
  ```
* **查看系統即時日誌**：
  ```bash
  sudo docker compose logs --tail=100 -f app
  ```
* **常見問題檢查清單**：
  * **無法登入**：請確認您使用的是 HTTPS 網址，並且網址列與 `.env` 中的 `APP_ORIGIN` 完全一致。
  * **發生 403 錯誤 (請從網站內送出操作)**：這通常也是因為網域設定不匹配導致 CSRF 阻擋，請檢查 `APP_ORIGIN`。
  * **查詢資料 502 / 503**：請先分辨 ASLUNG MySQL、背景成果覆蓋或 HOBO 來源錯誤；檢查對應連線、權限及 worker 日誌。


## 後續部署：網站與校正 worker

目前包含校正與 HOBO 的部署請使用：

```bash
cd ~/aslung-deployment/aslung_data
sudo bash scripts/deploy_cal.sh
sudo docker compose --profile calibration ps -a
curl -sS --max-time 15 http://127.0.0.1:3000/api/health
sudo docker compose --profile calibration logs --tail=80 calibration-worker
```

腳本會檢查 Git 狀態、建置、檢查儲存設定、備份並更新網站與 worker；排程沿用資料庫設定。`health=ok` 只表示網站可回應，外部資料來源須另行驗證。手動停止的 worker 不會僅因開機就恢復，可用 `sudo docker compose --profile calibration start calibration-worker` 明確啟動現有容器。

## 一般網站部署腳本：快取與耗時紀錄

以下 `deploy.sh` 說明適用一般網站更新；完整校正／HOBO 部署以本節前述 `deploy_cal.sh` 為準。

在 EC2 專案根目錄執行：

```bash
bash scripts/deploy.sh
```

腳本會分別列出 Git 遠端檢查、程式碼更新、Docker 映像建置、容器更新與健康檢查的秒數；Docker 的純文字進度保留各步驟的 `CACHED`、複製檔案、Next.js 編譯及映像匯出耗時。容器健康檢查最多等待 180 秒，失敗會回傳非零狀態，不會顯示部署成功。

Dockerfile 使用 BuildKit cache mounts，保留 `/app/.next/cache` 與 pnpm 套件快取。第一次採用新 Dockerfile 需要建立快取，後續在同一 Docker builder 上才會受益；不要在每次部署前清除 builder 快取。這些是 EC2/Linux Docker 的快取，本機 Windows 的 Next.js 快取仍維持在 K 槽。

同一版本要重新部署時可執行：

```bash
bash scripts/deploy.sh --force
```

`--force` 只表示即使 Git 沒有更新仍執行部署，不會關閉快取。沒有更新且在非互動環境中執行時，預設略過建置。需要近期 Docker Compose V2，支援 `--progress`、`up --wait` 與 `--wait-timeout`。

比較速度時，先執行一次建立快取，再修改程式碼進行第二次部署，比較 `Docker 映像建置` 和 `[build timing] Next.js build` 的時間。整份映像命中 Docker layer cache 的重跑，只能說明同版本部署速度，不等於程式變更後的編譯速度。

建置完成後才更新容器，建置失敗時不會執行容器更新。程式碼更新採 `git pull --ff-only`，分支分歧時中止並要求先處理 Git 狀態。
