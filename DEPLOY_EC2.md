# AWS EC2 部署步驟

使用 Ubuntu 24.04 LTS、Docker Engine / Compose、Nginx 與正式網域。
建置建議預留至少 4 GB 記憶體與 10 GB 可用磁碟，非 AWS 強制規格。
若 EC2 已有網站 / 資料庫，保留原有資料與設定，增加獨立網域即可。

## 1. EC2 網路與工具

- 網域 A 記錄指向固定公開 IP；可使用 Elastic IP。
- Security Group：SSH 22 僅允許管理 IP；網站開放 TCP 80、443。
- 程式 3000 綁定 127.0.0.1，不需對外開放，也不需開放資料庫埠。
- 此包不會搬移或修改原有量測資料庫。

AWS 官方：
https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/security-group-rules-reference.html

依官方 Ubuntu 指引安裝 Docker Engine 與 Compose：
https://docs.docker.com/engine/install/ubuntu/
https://docs.docker.com/compose/install/linux/

確認及安裝其他工具：

~~~bash
sudo docker version
sudo docker compose version
sudo apt update
sudo apt install -y nginx unzip
~~~

若其他服務已佔用 80/443，整合至既有代理，勿停止原有網站。

## 2. 上傳與設定

用 SCP / SFTP / WinSCP 將 aslung-ec2-deploy.zip 上傳到 EC2 家目錄。

~~~bash
mkdir -p ~/aslung-deployment
unzip ~/aslung-ec2-deploy.zip -d ~/aslung-deployment
cd ~/aslung-deployment/aslung-ec2
cp .env.example .env
chmod 600 .env
nano .env
~~~

設定範例：

~~~dotenv
APP_ORIGIN=https://aslung.your-domain.com
DATABASE_PATH=/app/data/aslung.sqlite
BACKUP_PATH=/app/backups
EC2_DATA_API_URL=
EC2_DATA_API_TOKEN=
NEXT_TELEMETRY_DISABLED=1
~~~

APP_ORIGIN 必須完全符合瀏覽器網址（含 HTTPS / 非標準埠），且無結尾斜線。
量測 API 網址 / token 可先留空，取得規格後再設定；不要寫入前端。
API 規格見 API_CONTRACT.md。

## 3. 建置與管理員

~~~bash
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs --tail=100 app
curl http://127.0.0.1:3000/api/health
sudo docker compose exec app node scripts/create-admin.mjs
~~~

health 預期回應 {"status":"ok"}，只代表程序正常。
管理員工具依提示輸入 Email、姓名、至少 12 字元密碼；密碼不顯示，
也不需要寫入命令列。重複 Email 不會覆寫原帳號。

首次建置需要對 Docker Hub / 套件註冊站的對外網路。
會員與授權資料會持久保存於 Docker named volume。

## 4. Nginx 與 HTTPS

編輯 deploy/nginx.conf，把 aslung.example.com 換成實際網域：

~~~bash
nano deploy/nginx.conf
sudo cp deploy/nginx.conf /etc/nginx/sites-available/aslung
sudo ln -s /etc/nginx/sites-available/aslung /etc/nginx/sites-enabled/aslung
sudo nginx -t
sudo systemctl reload nginx
~~~

若同名連結已存在，更新設定即可，勿刪除其他網站。
Nginx 測試失敗時先修正，再 reload。

依 Certbot 的 Nginx / Ubuntu 指引安裝：
https://certbot.eff.org/instructions

安裝後申請憑證並配置 Nginx：

~~~bash
sudo certbot --nginx -d aslung.your-domain.com
sudo certbot renew --dry-run
~~~

換成實際網域，確認 DNS 解析與 HTTP 80 可連線。
正式帳密只透過 HTTPS 輸入。APP_ORIGIN=https 時使用 Secure Cookie，
單純 HTTP 登入不會保留登入工作階段。

開啟正式 HTTPS 網址，使用剛建立的管理員登入。

## 5. 開通與資料串接

1. ASLUNG ID 管理：建立設備，ID 與原有資料庫一致。
2. 會員管理：建立姓名、Email、初始密碼。
3. 自行將帳密交給會員；網站不會寄出信件。
4. 資料授權：指定會員、ASLUNG ID、可查詢起訖時間。
5. 會員只能查詢授權設備及期間，可由側欄「變更密碼」。

取得量測 API 後修改 .env，再重新建立容器：

~~~bash
nano .env
sudo docker compose up -d --force-recreate
~~~

restart 不會重新讀取 env_file，所以設定變更應使用 recreate。

## 6. 備份 / 還原

一致性備份工具會處理 SQLite WAL，無需複製使用中的資料庫：

~~~bash
sudo docker compose exec app node scripts/backup.mjs
sudo docker compose exec app ls -l /app/backups
mkdir -p ~/aslung-backups
sudo docker compose cp app:/app/backups/. ~/aslung-backups/
~~~

另存至不同磁碟或 S3，並限制備份存取；備份含會員與密碼雜湊。
原有量測資料庫需另用原系統的備份方式。

還原前先備份目前狀態。將要還原的檔案命名 restore.sqlite，上傳至部署目錄。
以下會取代現在的會員 / 授權資料：

~~~bash
sudo docker compose stop app
sudo docker compose run --rm --no-deps -u root --entrypoint sh -v "$PWD/restore.sqlite:/restore.sqlite:ro" app -c 'cp /restore.sqlite /app/data/aslung.sqlite && rm -f /app/data/aslung.sqlite-wal /app/data/aslung.sqlite-shm && chown 1001:1001 /app/data/aslung.sqlite && chmod 600 /app/data/aslung.sqlite'
sudo docker compose up -d
~~~

請先確認 restore.sqlite 是有效備份，不可在容器執行中直接覆寫 SQLite。
備份包含當時的未到期工作階段，必要時在還原後清除 sessions。

## 7. 忘記密碼、更新與停止

~~~bash
sudo docker compose exec app node scripts/reset-password.mjs
~~~

輸入會員 / 管理員 Email 與新密碼，所有登入工作階段失效。
不會自行恢復停用帳號。

~~~bash
sudo docker compose stop
sudo docker compose up -d
sudo docker compose logs --tail=100 app
~~~

更新原始碼：

~~~bash
sudo docker compose up -d --build
~~~

不要使用 docker compose down -v，-v 會刪除本系統持久資料磁碟區。

| 問題 | 檢查 |
| --- | --- |
| 登入後又回登入頁 | HTTPS、APP_ORIGIN 與實際網域 |
| 操作 403「請從網站內送出操作」 | Origin 與 .env 網址是否完全一致 |
| 會員無法登入 | 已建立帳號、未停用、密碼正確；失敗太多等待 15 分鐘 |
| 量測查詢 503 | API URL / token 尚未設定 |
| 量測查詢 502 | HTTPS、憑證、token、網路、回應格式 |
| 資料期間 403 | 查詢超出授權起訖 |
| 下載 413 | 超過 50,000 筆，縮小期間 |
| 建置失敗 | 對外網路、套件下載、記憶體、磁碟 |

架構官方參考：
https://nextjs.org/docs/app/guides/self-hosting
https://docs.docker.com/guides/nextjs/
https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html
