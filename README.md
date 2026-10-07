# ASLUNG EC2 部署版

完整可修改的獨立網站原始碼，使用 Next.js / React / Node.js 24。
不需要 ChatGPT、Sites 或 Cloudflare 帳號即可執行。

## 已包含功能

- Email / 密碼登入；管理員開通或停用會員，無公開自行註冊。
- 管理員建立 ASLUNG ID，指派各會員可存取的設備與資料起訖期間。
- 期間查詢、資料表、JSON 預覽、CSV / JSON 下載。
- 下載合併分頁，上限 50,000 筆；所有查詢與下載均檢查伺服器端授權。
- 密碼加鹽 scrypt 雜湊、HttpOnly Cookie、HTTPS 下 Secure Cookie。
- 會員修改密碼；管理員終端建立帳號、重設密碼、一致性備份。
- 修改、重設密碼或停用帳號後，該帳號所有登入工作階段失效。

## 資料保存位置

| 資料 | 保存位置 |
| --- | --- |
| 會員、登入、設備名稱與期間授權 | EC2 本機 SQLite，Docker 的 aslung-data 持久磁碟區 |
| 量測資料 | 您原有 EC2 資料庫；網站透過 HTTPS API 查詢 |
| SQLite 備份 | Docker 的 aslung-backups 持久磁碟區 |

此包不含您的真實量測資料、線上會員設定或任何密碼。
請重新建立 EC2 版的管理員與會員。登入方式與先前 ChatGPT 登入版分開。

## 完整目錄

| 路徑 | 內容 |
| --- | --- |
| app/ | 完整網站頁面、樣式與 API |
| app/workspace.tsx | 查詢、會員、ASLUNG ID、期間授權介面 |
| app/login/ | Email / 密碼登入 |
| app/api/auth/ | 登入、登出、修改密碼 |
| app/api/manage/ | 會員、設備、授權管理 |
| app/api/data/ | JSON 查詢及 CSV / JSON 下載 |
| app/api/health/ | 程式存活檢查 |
| lib/ | SQLite、密碼、登入、權限與量測 API 串接 |
| components/、hooks/、vendor/ | 完整 UI 元件與樣式 |
| public/ | 靜態資源 |
| scripts/ | 建立管理員、重設密碼、備份 |
| deploy/nginx.conf | Nginx 反向代理範本 |
| tests/ | 密碼、資料庫及正式 HTTP 流程測試 |
| Dockerfile、compose.yaml | Docker 建置、啟動與持久資料磁碟區 |
| .env.example | 設定範本 |
| package.json、pnpm-lock.yaml | 指令與鎖定相依套件 |
| DIRECTORY_MANIFEST.txt | 包內每個檔案的實際路徑清單 |
| DEPLOY_EC2.md | Ubuntu EC2 完整部署步驟 |
| API_CONTRACT.md | 既有量測資料 API 的串接規格 |
| VERIFICATION.md | 驗證結果與限制 |

不包含 node_modules、建置快取、測試資料庫、Git 設定及帳密。
部署時依鎖定檔安裝套件並建立正式版本；這些排除項目不影響原始碼完整性。

## 快速開始

已有 Docker / Compose 時，先閱讀 DEPLOY_EC2.md：

~~~bash
cp .env.example .env
nano .env
sudo docker compose up -d --build
sudo docker compose exec app node scripts/create-admin.mjs
~~~

設定正式 HTTPS 網域並完成 Nginx / TLS 後即可登入。
管理員不會由第一位訪客自動建立，必须使用終端工具建立。

未設定 EC2_DATA_API_URL / EC2_DATA_API_TOKEN 時，會員、設備與授權可正常設定。
量測查詢會顯示尚未連接，不會填入模擬資料。
若既有資料庫尚無 API，仍需依 API_CONTRACT.md 建立資料查詢服务。
本包不假設您使用哪一種資料庫，也不會直接更動既有量測資料。

## 本機開發 / 非 Docker 執行

安裝 Node.js 24.13 以上；使用 package.json 鎖定的 pnpm 版本：

~~~bash
corepack enable
corepack pnpm install --frozen-lockfile
cp .env.example .env
~~~

本機 .env 使用：

~~~dotenv
APP_ORIGIN=http://localhost:3000
DATABASE_PATH=./data/aslung.sqlite
BACKUP_PATH=./backups
~~~

量測 API 設定可先留空。HTTP 僅適合本機測試。

~~~bash
corepack pnpm admin:create
corepack pnpm dev
~~~

正式 Node.js 模式：

~~~bash
corepack pnpm build
corepack pnpm start
~~~

start 綁定 127.0.0.1:3000。EC2 建議使用附帶 Docker Compose；
非 Docker 模式需自行配置 systemd 等程序管理。

## 測試

~~~bash
corepack pnpm test
corepack pnpm build
corepack pnpm test:integration
~~~

HTTP 測試自動選擇空閒本機埠，使用臨時 SQLite / 帳號，結束後移除。
不連接真實量測資料庫。

## 範圍

此包適用單一 EC2 / 單一應用實例。SQLite 保存會員與授權，非量測資料倉庫。
不含多實例共享帳號資料、自助註冊、郵件驗證、Email 寄送或 MFA。
忘記密碼使用管理員終端重設工具。本站 JSON API 使用會員工作階段；
機器帳號 API key / OAuth 需另外實作。
