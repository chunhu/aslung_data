# ASLUNG EC2 部署版

語系按鈕顯示可切換的目標語言：中文介面顯示 `English`，英文介面顯示 `中文`，不使用語系下拉選單。未手動選擇時依瀏覽器首選語言判定；`zh-TW`、`zh-Hant`、`zh-HK`、`zh-MO` 顯示繁體中文，簡體中文及其他語系顯示英文。明確的語言連結與手動切換會記住選擇，登入、註冊、Email 驗證及工作空間共用設定。登入與註冊頁切換語言不重新載入，保留表單內容；工作空間沿用現有 Google 翻譯機制並重新載入套用。

## 設備維修保養

設備清單可點擊狀態、目前地點或負責人快速更新，先檢查變更再確認儲存，原編輯／移轉入口仍保留。地點提供可搜尋的已建檔地點選單，可設定負責人及依所選時區填寫生效時間；移轉會結束舊部署並建立新部署，快速更新不接受未來日期、重疊期間或重複部署。未部署設備需先建立部署才能快速指派負責人。狀態改為維修中時可勾選同時建立維修單；未結案維修單會阻止快速改為待命或重新部署。快速操作僅限管理員，並檢查狀態與目前部署是否已被其他操作變更，避免覆寫更新。

「維修保養」選單提供跨設備總覽；設備履歷中的「維修保養」頁籤可查看單台紀錄。支援故障維修、定期保養、校正與更換零件，依待處理、處理中、待驗收、已完成流程更新，也可填寫原因後取消。可依設備、主旨、負責人、廠商、類型、進度及到期日期篩選。

每筆紀錄保留建立當時的部署地點與維護人員；處理說明、進度異動、費用與驗收結果均保留歷程。已結案紀錄以追加說明更正，不能覆寫結案內容。管理員可選擇在建單時將設備改為維修中並結束目前部署，或在驗收完成時改為待命；兩者都不會自動重新部署，其他未結案維修單也會阻止提前改為待命。

管理員可存取全部紀錄。一般帳號必須以維護人員名單中的 Email 符合目前部署負責人，才能為該設備建立紀錄；原建立人與已指派承辦人可繼續存取其維修單。姓名相同或取得量測資料授權，不會取得維修資料權限。承辦負責人由管理員指派，可於未結案時變更。

附件接受 PDF、PNG、JPEG、WebP，檢查實際檔案格式，每檔最多 5 MB、每單最多 20 檔；以私有下載方式提供，與紀錄一起儲存在 SQLite，現有資料庫備份包含附件。有維修履歷的設備不能直接刪除，請改為報廢或其他設備狀態以保留履歷。第一階段提供畫面到期提醒，不會自動寄信或建立週期保養單；下次保養日期為各筆紀錄獨立保存，完成後續保養不會自動清除舊單日期。

EC2 若已有獨立的 Nginx 設定，請在網站的 `server` 區塊設定 `client_max_body_size 6m;`，再執行 `sudo nginx -t && sudo systemctl reload nginx`，才能上傳接近 5 MB 的附件；本專案的 Nginx 範本已同步調整。只重新部署 Docker 不會更新主機既有 Nginx 設定。

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

## 設備營運管理（本機修改版）

管理員的「ASLUNG ID 管理」提供設備總覽、每頁 50 台的清單、依地點／負責人／連線／資料品質篩選、CSV 匯出與常用篩選。常用篩選依帳號保存在目前瀏覽器，不跨裝置同步。連線門檻沿用告警設定；尚未取得量測資料時不會直接判為離線。

選取設備後可批次指派負責人或變更狀態，套用前會說明影響範圍。批次送修／待命等操作會結束使用中部署並保留歷史；批次指派要求每台設備恰有一筆使用中部署，任何設備不符時整批不寫入。點擊設備編號可查看部署歷史、近期告警及新版操作的管理紀錄。原有 QR Code、移轉、授權與刪除仍可使用。

Google 試算表與 CSV／TSV 匯入改為「選擇來源 → 對應欄位 → 預覽與套用」。支援修正設備編號與類型的對應，並列出新增、更新、不變、略過與資料問題；有錯誤時無法套用。預覽不寫入設備資料，確認時使用同一份來源內容，並檢查資料是否已被其他操作修改。只更新相同地點＋設備＋開始時間的紀錄，未出現在來源中的歷史不會被刪除。

新增的 `/api/fleet` 只允許管理員使用；寫入檢查 Origin，批次操作與匯入均以 SQLite 交易處理。新版批次操作與匯入會自動建立 `device_events` 管理紀錄，不回填舊版操作紀錄。

「即時線上狀態」隱藏未部署且最後上傳超過一年的設備；已部署設備即使長期離線仍顯示。這項篩選不會刪除設備，也不影響設備管理的完整清單。

管理員可按「搜尋未建檔設備」，以近 1／7／30／365 天為範圍直接搜尋 MySQL `rawdata`，查看未在網站建檔的設備最新量測。查詢為手動觸發、最多 200 台，達上限會提示縮小期間；來源需有適當的時間與設備索引，大範圍查詢逾時時可縮小範圍重試。找到的設備在本頁停留期間會加入一般即時更新，只查這些已找到的編號，不重複掃描歷史。結果標記「未建檔」，可按「補登設備」帶入編號後自行填寫地點；不會自動推定部署狀態、建立設備或變更會員授權。一般會員不能使用此搜尋功能。

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
