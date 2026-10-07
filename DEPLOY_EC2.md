# AWS EC2 部署指南

本專案使用 **Ubuntu 24.04 LTS**、**Docker Engine / Compose**、**Nginx**，並強烈建議配置正式網域與 HTTPS，以符合安全性最佳實踐。

建置建議預留至少 4 GB 記憶體與 10 GB 可用磁碟空間（非強制規格）。
如果您現有的 EC2 已經運行其他網站或資料庫，只需保留原有資料，將本系統綁定獨立網域即可共存。

---

## 1. 網路與基本環境設定

1. **DNS 設定**：將您的網域 A 記錄（例如 `aslung.your-domain.com`）指向 EC2 的公開固定 IP（建議使用 AWS Elastic IP）。
2. **Security Group 防火牆**：
   * SSH `TCP 22`：僅允許管理員的 IP 存取。
   * HTTP/HTTPS `TCP 80` 及 `TCP 443`：對全球開放（`0.0.0.0/0`）。
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
git clone https://github.com/chunhu/aslung_data.git .

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

# 若尚未串接測站資料庫，這兩項可留空
EC2_DATA_API_URL=
EC2_DATA_API_TOKEN=

NEXT_TELEMETRY_DISABLED=1
```

---

## 3. 建置服務與建立初始管理員

```bash
# 在背景啟動並建立容器
sudo docker compose up -d --build

# 確認服務運行狀態
sudo docker compose ps
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

## 5. 後續設定與資料庫串接

登入系統後，您可以開始進行下列管理：
1. **ASLUNG ID 管理**：建立對應的設備 ID 供授權使用。
2. **會員管理**：建立其他會員帳號（包含帳號暱稱與初始密碼），並將帳密交給對方。
3. **資料授權**：指派特定會員可查詢的 ASLUNG ID 及時間範圍。

若後續完成測站資料庫的串接 API 開發：
```bash
# 修改環境變數
nano .env

# 重新建立容器載入最新環境變數
sudo docker compose up -d --force-recreate
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

**還原備份**（將備份檔覆蓋回資料庫）：
```bash
sudo docker compose stop app
# 將 restore.sqlite 覆蓋現有資料庫並清除暫存日誌
sudo docker compose run --rm --no-deps -u root --entrypoint sh -v "$PWD/restore.sqlite:/restore.sqlite:ro" app -c 'cp /restore.sqlite /app/data/aslung.sqlite && rm -f /app/data/aslung.sqlite-wal /app/data/aslung.sqlite-shm && chown 1001:1001 /app/data/aslung.sqlite && chmod 600 /app/data/aslung.sqlite'
sudo docker compose up -d
```

---

## 7. 疑難排解與實用指令

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
  * **查詢資料 502 / 503**：請確認 `.env` 內的 API Token 格式正確或 API Endpoint 連線暢通。
