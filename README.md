# ASLUNG EC2 部署版

## 完整說明文件（2026-10-22）

- [繁體中文網站手冊](docs/ASLUNG_Website_User_Manual_ZH.md)／[English website manual](docs/ASLUNG_Website_User_Manual_EN.md)
- [中文 API 指南](docs/ASLUNG_API_User_Guide_ZH.md)／[English API guide](docs/ASLUNG_API_User_Guide_EN.md)
- Word 與可離線閱讀的 HTML 在 `public/docs/`；網站「資料串接」提供閱讀與下載。
- 維護 Markdown 後執行 `scripts/generate-website-docs.py`，同步四份 Word、HTML 與公開副本；`--check` 檢查副本一致性。

維護人員可在新增／編輯表單填寫 `english_name`（英文完整稱呼，選填，最多 160 字）。中文介面保留原姓名，英文介面顯示已填寫的英文稱呼；未填時保留原名稱，姓名標記為不自動翻譯，名單不再顯示姓名首字圓形頭像。設備負責人、快速更新選單、維修保養與告警名單共用此顯示規則，選單儲存值仍使用原姓名，既有設備關聯及通知信箱不變。Google 試算表建議表頭為 `Cht_name | Eng_name | mail | mail_test`（不分大小寫、前後空白可忽略），`Cht_name` 作為中文姓名識別、`Eng_name` 作為英文稱呼，保留舊版 `maintainer` 表頭；若新舊表頭同時存在，以 `Cht_name`／`Eng_name` 優先。英文欄位亦相容 `english_name`、`name_en`、`英文名`、`英文名稱`、`英文稱呼` 或 `英文姓名` 欄位；沒有該欄位時保留手動設定，有該欄位但空白則清除英文稱呼。

維護人員「同步 Google 試算表」採三步驟：讀取分頁 → 確認欄位對應 → 預覽與確認匯入。管理員可指定任意來源欄位為「備註說明」，並對應姓名、主要 Email、英文稱呼、測試信箱與電話。姓名及主要 Email 必填；選填欄位可選「不匯入（保留既有值）」，已對應欄位的空白值則會清空既有值。預覽顯示新增、更新、不變及帶有來源列號的錯誤；錯誤修正前不會寫入任何資料。最多 2 MB／5,000 列，確認後以姓名比對，保留未列出的人員、停寄設定及會員關聯；來源快照、欄位對應或名冊改變後須重新預覽。讀取與預覽不修改名冊，舊版 `maintainerSyncGoogle` 動作亦僅讀取來源。


語系按鈕顯示可切換的目標語言：中文介面顯示 `English`，英文介面顯示 `中文`，不使用語系下拉選單。未手動選擇時依瀏覽器首選語言判定；`zh-TW`、`zh-Hant`、`zh-HK`、`zh-MO` 顯示繁體中文，簡體中文及其他語系顯示英文。明確的語言連結與手動切換會記住選擇，登入、註冊、Email 驗證及工作空間共用設定。登入與註冊頁切換語言不重新載入，保留表單內容；工作空間沿用現有 Google 翻譯機制並重新載入套用。

## 設備維修保養

維護人員名冊的新增／編輯表單提供「接收斷線通知」，名冊顯示「接收／已停寄」。既有與新建人員預設接收；關閉後該維護人員的手動、定期斷線通知皆不寄送，包含關聯會員與測試信箱，仍保留畫面警示及略過寄送的紀錄。此設定不需要會員帳號，也不影響其他維護人員。Google 試算表同步會保留網站設定，不會重新開啟；重新勾選並儲存即可恢復（仍須符合會員收信偏好及既有寄信條件）。

The maintainer directory's add/edit form includes “Receive disconnection notifications,” enabled by default. Disabling it suppresses manual and scheduled disconnection emails for that maintainer, including linked accounts and test addresses, while retaining on-screen warnings and skipped-delivery logs. No member account is required. Google Sheet synchronization preserves this preference. Re-enabling remains subject to member opt-outs and existing delivery rules.

設備清單可點擊狀態、目前地點或負責人快速更新，先檢查變更再確認儲存，原編輯／移轉入口仍保留。地點提供可搜尋的已建檔地點選單，可設定負責人及依所選時區填寫生效時間；移轉會結束舊部署並建立新部署，快速更新不接受未來日期、重疊期間或重複部署。未部署設備需先建立部署才能快速指派負責人。狀態改為維修中時可勾選同時建立維修單；未結案維修單會阻止快速改為待命或重新部署。快速操作僅限管理員，並檢查狀態與目前部署是否已被其他操作變更，避免覆寫更新。

「維修保養」選單提供跨設備總覽；設備履歷中的「維修保養」頁籤可查看單台紀錄。支援故障維修、定期保養、校正與更換零件，依待處理、處理中、待驗收、已完成流程更新，也可填寫原因後取消。可依設備、主旨、負責人、廠商、類型、進度及到期日期篩選。

每筆紀錄保留建立當時的部署地點與維護人員；處理說明、進度異動、費用與驗收結果均保留歷程。已結案紀錄以追加說明更正，不能覆寫結案內容。管理員可選擇在建單時將設備改為維修中並結束目前部署，或在驗收完成時改為待命；兩者都不會自動重新部署，其他未結案維修單也會阻止提前改為待命。

管理員可存取全部紀錄。一般帳號必須以維護人員名單中的 Email 符合目前部署負責人，才能為該設備建立紀錄；原建立人與已指派承辦人可繼續存取其維修單。姓名相同或取得量測資料授權，不會取得維修資料權限。承辦負責人由管理員指派，可於未結案時變更。

附件接受 PDF、PNG、JPEG、WebP，檢查實際檔案格式，每檔最多 5 MB、每單最多 20 檔；以私有下載方式提供，與紀錄一起儲存在 SQLite，現有資料庫備份包含附件。有維修履歷的設備不能直接刪除，請改為報廢或其他設備狀態以保留履歷。第一階段提供畫面到期提醒，不會自動寄信或建立週期保養單；下次保養日期為各筆紀錄獨立保存，完成後續保養不會自動清除舊單日期。

EC2 若已有獨立的 Nginx 設定，請在網站的 `server` 區塊設定 `client_max_body_size 6m;`，再執行 `sudo nginx -t && sudo systemctl reload nginx`，才能上傳接近 5 MB 的附件；本專案的 Nginx 範本已同步調整。只重新部署 Docker 不會更新主機既有 Nginx 設定。

完整可修改的獨立網站原始碼，使用 Next.js / React / Node.js 24。
不需要 ChatGPT、Sites 或 Cloudflare 帳號即可執行。

## 已包含功能

### 功能存取設定與共用群組

管理員在「網站管理 → 功能存取設定」逐項選擇「沿用角色預設」或「限指定會員／群組」。指定名單採聯集：會員本人被選取，或屬於任一允許群組即可通過此層檢查；角色權限仍是上限，不會因加入名單取得原角色沒有的功能。空名單僅管理員可進入。未設定的功能保持角色預設，管理員永遠保留全部管理入口，避免誤設鎖住系統。支援搜尋、多選、全選、會員限制預覽、設定版本衝突檢查，以及最近 50 筆完整前後異動紀錄。

群組與檔案專區共用既有 `file_groups`／`file_group_members`，不複製成員。兩處修改都會留下共用群組的前後紀錄；成員退出會在後續請求同時失去群組衍生的功能與檔案權限。刪除群組會撤銷其檔案授權；功能的「指定名單」模式保留，不會因最後一個群組被刪除而恢復全面開放。更新群組會先提示其跨功能影響。

中央身分檢查依功能拒絕未授權的頁面資料/API，包括既有 API Token、私密文章與所屬圖片。工作空間只顯示允許的選單，切換到不可用頁面會改開第一個可用功能；全部關閉時顯示聯絡管理員的空白狀態，仍可登出與修改自身帳號資料。重新整理、切換頁面或視窗取得焦點時會重讀權限；伺服器於每次 API 請求重新驗證，不依瀏覽器的可見選單授權。已傳送到瀏覽器的內容無法收回。

功能限制不取代設備、資料期間、檔案、維護負責人或案件權限；預覽顯示角色與功能名單的結果，維護／案件等動態條件仍依原有授權判斷。公開文章、公開文章圖片、公開檔案說明及已核准訪客分享使用獨立的公開／訪客規則，不會因會員選單被隱藏自動變為私密；敏感內容仍須取消公開或停用分享。HOBO、會員管理等原本僅限管理員的功能維持原角色限制。

Feature access is an additional restriction within existing roles. Administrators may keep role defaults or select individual members and shared groups, with OR semantics. An empty allowlist excludes every non-admin; administrators always retain recovery access. The same member groups are used for file permissions. Server-side request checks protect API calls and private post images, including API tokens; individual data/file grants and public/guest sharing rules remain independent. Changes and shared-group edits are audited and version checked.

### 檔案專區全部分類

進入檔案專區預設顯示「全部分類」，合併所有有權限瀏覽的檔案，逐筆顯示所屬分類；可跨分類搜尋並依原規則分頁（每頁 50 筆）。下拉選單仍可切換「未分類」或單一分類，不會將其他分類的未授權檔案加入清單。「全部分類」下新增檔案或外部連結時，需明確選擇具管理權限的存放分類，檔案繼承該分類授權；彙總檢視本身不是可授權或刪除的資料夾。API 可使用 `/api/files?folder=all`；未帶 folder 的既有 API 呼叫仍保持未分類行為。

### 訪客檔案分享（免會員、雙軌）

管理員進入「檔案專區」，按檔案旁的「訪客分享」：

- **直接分享**：填寫收件人姓名、單位、Email、用途、到期時間與下載次數，建立後寄送指定收件人的連結。
- **公開申請**：勾選「公開檔案說明，接受訪客申請下載」。公開網站的「公開檔案」入口為 `/file-catalog`，只提供檔名、說明與申請，不提供原始網址或檔案內容。訪客填寫姓名、單位、Email、用途，完成 Email 驗證後才進入待審核清單。管理員核准並指定期限／次數後寄送連結；不核准則保留審核紀錄、不產生連結。

所有檔案預設不公開，設定不改動既有會員／資料夾授權。公開說明必須適合外部閱讀；關閉公開只停止新的公開申請，不撤銷已核准連結。已核准或直接建立的連結請另按「停用」。

收件人從 Email 的 `/file-share#token=…` 開啟分享頁，另取 Email 驗證碼後下載，不建立會員。連結、驗證工作階段及驗證碼僅保存雜湊；連結密鑰不放在 URL 查詢參數或伺服器日誌。驗證碼有效 10 分鐘、最多嘗試 5 次、不可重複使用；下載驗證工作階段有效 30 分鐘且不超過連結期限。每個連結每小時最多寄送 5 次驗證碼，另有 Email、網站及來源 IP 的頻率限制。到期時間必填，最長一年，下載次數 1–10000，表單預設 7 天／3 次。重新寄送會更換連結，原連結、驗證碼與工作階段失效；停用後不可再取得新下載。已開始的傳送不會因停用而收回。

在「檔案專區 → 訪客申請審核與下載紀錄（所有檔案）」集中處理，或逐檔查看：申請狀態、收件人、單位、用途、信件寄送狀態、期限、已用／上限次數、下載時間、IP（依既有可信代理設定）、瀏覽器、傳送位元組與結果。可依關鍵字、檔案、時間、申請／下載狀態搜尋，每頁 30 筆；CSV 使用同一篩選條件，單次最多 10000 筆，超過需縮小條件。申請與下載紀錄保存於 SQLite，隨既有備份保存；目前不自動刪除，請依機構個資保留政策管理資料庫備份與存取。

次數在伺服器接受傳送時原子扣除，中斷也計入；缺少檔案實體不扣次數。紀錄區分「傳送中／結果未確認」「伺服器傳送完成」「中斷」「失敗」「外部轉址」。伺服器傳送完成無法保證使用者已另存或閱讀。伺服器意外停止時，未確認的傳送可能保留開始狀態。外部連結僅限制經本站取得網址的次數，取得原始網址後的直接存取不受本站控制；嚴格控管請使用上傳檔案。既有上傳檔案仍使用現有本機儲存路徑，本功能不會自動搬移到 S3。

部署後需設定正確的 `APP_ORIGIN`，並使用「設備斷線通知 → 郵件設定」中的 SMTP。驗證碼與連結郵件為中英文；寄信失敗不顯示驗證碼或密鑰。核准／建立連結後寄送失敗會保留設定並標記失敗，可修正 SMTP 後重新寄送。此階段不主動寄送拒絕信或新申請通知，管理員從檔案專區待審核清單處理。測試皆使用假 SMTP、記憶體資料庫，不會寄送真實通知。

Guest file access supports two paths without membership: an administrator sends a recipient-bound link directly, or publishes metadata for an email-verified application and approves it before issuing a link. Recipients verify their email again before downloading. Every link has a mandatory expiration and quota and can be revoked. Public metadata does not expose content or storage URLs. Download records are searchable, paginated and exportable to CSV; started, completed, interrupted, failed and external-redirect outcomes remain distinct. Accepted transfers consume quota even if interrupted. External URLs cannot be controlled after disclosure. Existing member permissions remain independent; all files stay private until explicitly published. Configure the existing SMTP settings and `APP_ORIGIN` before use.

資料存取授權的「新增授權」支援按地點或設備多選，可搜尋編號／名稱、全選、選取搜尋結果及清除選取，並顯示已選數量。同一批使用相同會員與日期設定，儲存後每個標的各建立一筆授權；完全相同的既有授權會略過。若任一標的不存在或寫入失敗，整批不會新增。設備全選僅包含目前清單，未來新增設備須另行授權；地點授權仍依原有設備在站期間動態涵蓋未來進駐設備。既有授權維持單筆編輯。

New data access grants support multiple locations or devices, search, select all, select matching results, and clear selection. Each selected target receives a separate grant with the same member and date settings. Exact duplicates are skipped, and a validation or write failure rolls back the entire batch. Selecting all devices covers the current list only; location grants retain their existing dynamic deployment rules. Existing grants are edited individually.

- Email / 密碼登入、自助註冊、Email 驗證與管理員審核；角色與資料授權分開管理。
- 管理員建立 ASLUNG ID，指派各會員可存取的設備與資料起訖期間。
- 期間查詢、資料表、JSON 預覽、CSV ZIP / JSON ZIP 下載。
- 下載合併分頁；一般帳號單次最多 31 天，所有查詢與下載均檢查伺服器端授權。
- 設備追蹤、維修、告警、校正管理、HOBO 定期同步，以及本機／S3 成果清除。
- 個人 API token、原始／即時係數／背景成果查詢與中英文下載說明。
- 密碼加鹽 scrypt 雜湊、HttpOnly Cookie、HTTPS 下 Secure Cookie。
- 會員修改密碼、忘記密碼郵件重設；管理員終端建立帳號、重設密碼、一致性備份。
- 修改、重設密碼或停用帳號後，該帳號所有登入工作階段失效。

## 資料保存位置

| 資料 | 保存位置 |
| --- | --- |
| 會員、登入、設備名稱與期間授權 | EC2 本機 SQLite，Docker 的 aslung-data 持久磁碟區 |
| 量測資料 | 既有 MySQL rawdata 表，由網站後端直接唯讀查詢 |
| 校正成果、HOBO 觀測 | 本機持久目錄或 S3；設定與索引保存在 SQLite |
| SQLite 備份 | Docker 的 aslung-backups 持久磁碟區 |

此包不含您的真實量測資料、線上會員設定或任何密碼。
請重新建立 EC2 版的管理員與會員。登入方式與先前 ChatGPT 登入版分開。

## 完整目錄

| 路徑 | 內容 |
| --- | --- |
| app/ | 完整網站頁面、樣式與 API |
| app/workspace.tsx | 查詢、會員、ASLUNG ID、期間授權介面 |
| app/login/ | Email / 密碼登入 |
| app/api/auth/ | 登入、登出、修改／忘記密碼 |
| app/api/manage/ | 會員、設備、授權管理 |
| app/api/data/ | JSON 查詢及 CSV ZIP / JSON ZIP 下載 |
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

ASLUNG 量測查詢須設定 `MYSQL_HOST`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`，並確認資料庫網路可達。HOBO 須另設 `LICOR_API_TOKEN`；寄信功能須完成網站 SMTP 設定。服務健康檢查不代表外部資料來源均已連通。

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

僅測試登入介面時可暫不設定 MySQL；實際量測查詢需完成來源連線。HTTP 僅適合本機測試。

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

「ASLUNG ID 管理 → 同步試算表」可勾選「確認匯入後啟用定期同步資料」，使用與通知排程相同的三種模式：「固定間隔」（1–10080 分鐘，預設 60）、「每天固定時間」或「每週固定時間」（勾選星期），固定時間以 Asia/Taipei 解讀。開啟或變更網址時會載入已儲存的排程設定；需完成欄位對應、預覽並最後確認，才一併儲存匯入與排程，取消視窗不改動設定。未勾選並確認匯入會停用該網址的既有排程。亦可在同視窗「管理既有定期同步排程」直接啟用、停用或變更週期，查看下次時間與最近執行結果，不需重新匯入。

排程保存在 SQLite，網站伺服器每分鐘檢查到期來源，重啟後沿用；固定間隔從儲存時間加上週期安排；每天／每週模式計算下一個臺灣時間時段。完成或失敗後跳至下一個指定時段，不在同一時段重複執行；重啟後逾期排程補執行一次，再安排下一個未來時段。不在瀏覽器計時，也不需保持頁面開啟。自動同步沿用最後確認的完整表頭、欄位對應及設備類型篩選；表頭變更、資料錯誤、預覽失效或管理員權限被撤銷時整次不套用，保留原資料並記錄錯誤列號。來源未列出的既有部署不刪除，重複資料不新增重複紀錄。共用來源租約避免多個伺服器同時抓取；停用或修改排程後，尚未寫入的舊請求無法套用。實際開始時間受每分鐘檢查、來源數量及上游回應影響；失敗於下一週期再試。Google 分頁需能供伺服器讀取 CSV，手動上傳 CSV 不提供定期同步。自動匯入會覆寫同地點、設備與開始時間紀錄的負責人／結束時間／狀態，請確認來源內容。

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

此包適用單一 EC2 / 單一應用實例，網站與校正 worker 共用 SQLite 持久磁碟區。SQLite 保存設定、授權、工作索引及 HOBO 本機資料；ASLUNG 原始量測仍由 MySQL 提供。
已包含自助註冊、郵件驗證、SMTP 通知與個人 API token；未提供多實例共享部署、OAuth 或 MFA。忘記密碼可由登入頁申請 Email 重設連結；沒有登記可收信 Email 的帳號仍使用管理員終端重設工具。備份 SQLite 時，仍須另外保護 MySQL、本機成果及 S3 物件。


### 設備斷線通知與會員收信偏好

設備斷線通知信以同一封中英文雙語信件寄出，主旨使用「ASLUNG 設備斷線通知 / Device Disconnection Notification」。HTML 與純文字皆包含負責人、斷線數量、門檻分鐘數、設備及地點、離線時間、最後上傳時間、檢查編號與處理建議；時間明列 UTC+8／Asia/Taipei。查詢失敗的設備另行說明，不列入斷線數量。雙語版本沿用原本排程、收件人、停收偏好及避免重複寄送規則，不額外寄送第二封信。

- 已部署設備仍依斷線門檻顯示警示；從未上傳資料或最後回報早於一個曆年前的設備不列入告警信的內容與數量，日誌標記為「僅警示，未寄信」並記錄原因。查詢失敗仍記為狀態未知。
- 管理員可在「會員管理 → 告警收信」調整任一會員；所有已登入會員可在側欄「斷線通知收信設定」調整自己。既有及新會員預設接收，設定保存在 SQLite `members.alert_email_enabled`，啟動時自動新增欄位。
- 寄信仍以設備目前維護人員的聯絡信箱為對象；會員開啟收信不會增加設備授權或訂閱其他設備。信箱大小寫不影響比對，已停用會員不寄送。測試信箱模式也遵守主要聯絡會員的停收設定。未註冊成會員的維護人員沿用原寄信方式。
- 此偏好僅影響設備斷線告警，不影響註冊驗證及帳號審核信。通知負責人數與最後告警寄送時間以實際成功寄送為準。


### 會員專屬設備與校正（試用版）

研究會員與系統管理員可開啟側欄「設備管理 → 我的設備與校正」。會員提交 ASLUNG ID 與備註/說明，管理員在同頁核對設備及資料接收設定，指定資料可讀起日（UTC），選擇是否開啟個人校正權限，再核准綁定；尚未建檔者可明確勾選一併建立設備。核准會建立獨立的設備資料授權，不會設定硬體上傳或改寫 MySQL。單台設備同時只允許一位擁有者。解除綁定需輸入 `REVOKE`，只結束該綁定建立的授權，保留其他獨立授權及歷史；移轉給新會員的資料起日不可早於前次交接時間。

管理員可在已解除綁定的歸屬紀錄旁按「刪除紀錄」，輸入 `DELETE` 確認後從清單移除。使用中的綁定須先解除才可刪除；研究會員不可刪除歸屬紀錄。刪除採封存並保留交接時間及完整稽核，防止後續移轉繞過歷史期間限制；不刪除會員、設備、既有資料授權、量測資料或校正參數。

「綁定申請紀錄」另提供管理員刪除功能，需輸入 `DELETE` 確認。待審核申請刪除後停止審核，會員可重新申請；已核准／未核准紀錄亦可從清單移除。刪除申請不影響既有設備歸屬、資料授權、量測或校正參數；保留原申請與刪除操作的稽核紀錄。

「我的校正參數」支援 Google 試算表分頁（沿用伺服器唯讀服務帳號／可讀 CSV）及上傳或貼上 CSV。CSV 先檢查與預覽再套用，提供範本；每個檔案最多 2 MB、5000 筆，每位會員最多 20 個有效來源。僅接受目前已核准歸屬且開啟個人校正權限的設備。Google 可選每日臺灣時間 02:00 同步，伺服器每分鐘檢查到期來源；失敗保留舊版本。編輯及單筆／本頁批量刪除建立新版本，歷史唯讀；手動修改後預設阻擋 Google 覆蓋，可勾選來源的覆蓋許可。刪除來源採封存，保留歷史版本與稽核。個人參數完全獨立於官方參數及背景六項工作。

量測查詢及 ZIP 下載可選「原始值＋我的校正參數」。API 使用 `/api/data?calibration=personal`，分頁／下載帶回 `calibration_snapshot=personal:<版本編號列表>` 固定參數。會員只能引用本人版本，且每次重新驗證設備歸屬、個人校正權限與原有量測資料授權；撤銷權限立即生效。缺係數顯示 `NO_FACTOR`，不改套官方值，輸出含 `_calibration_scope=personal` 與各通道版本欄位。此階段不提供會員個人背景六項重算、會員自行分享／移轉或自動驗證硬體上傳；分享與移轉由管理員依授權及交接流程處理。

Research members can request ownership binding under **My devices and calibration**. Administrators verify the device and ingestion setup, approve the UTC data-access start and enable personal calibration per device. Ownership and measurement grants remain separate, transfers cannot overlap previous ownership periods, and releasing ownership closes only its associated grant. Personal Google/CSV sources and immutable versions are stored separately from official coefficients. CSV supports validation, preview, a template and version export. Google supports opt-in daily synchronization with manual-change protection. Query/export with `calibration=personal` and return the `personal:` snapshot to pin versions. Ownership, calibration permission and measurement access are checked on every request; other members' versions are never accessible. Missing private coefficients produce `NO_FACTOR` without official fallback. Personal six-rule background processing is outside this first release.

### 官方多來源校正管理

管理員可在「校正管理」新增多個 Google 試算表分頁網址、名稱與說明，手動同步、啟用或停用來源，查詢全部設備與歷史版本。此功能不會建立或改動設備授權，不會改寫 MySQL 原始量測資料；現有 admin/member 分級維持不變。

「設備校正參數查詢」提供編輯、單筆刪除，以及勾選本頁參數後批量刪除（每批最多 200 筆）。系統管理員與校正管理員可操作來源目前版本；歷史版本僅供查詢。編輯器時間以 UTC 輸入，結束時間為不包含的上限；空白代表無上限。參數格式、第二段係數與期間衝突驗證失敗時不寫入；刪除須輸入 `DELETE` 確認。

修改會為每個受影響來源建立新版本，保留舊係數、原表日期、操作人與稽核事件。批量操作在同一交易完成；來源同步中或參數版本已變更時拒絕操作，需重新整理。刪除不擴大其他參數的適用區間，也不重算已完成成果。手動修改後，參數列顯示「已手動編輯」、修改時間及操作人；預設暫停該來源自動同步，但啟用來源的目前係數仍可套用。來源卡片提供「允許同步資料覆蓋手動修改」勾選項，套用於整個來源（含刪除項目）：勾選後允許後續手動及每日同步採用已修正試算表；取消勾選恢復保護。未勾選時按「立即同步」仍可確認一次性覆蓋（已刪除參數可能重新匯入）。同步成功後使用來源新版本，失敗則保留目前手動參數及覆蓋偏好。再次編輯或刪除會重新取消覆蓋許可。設定變更保留稽核紀錄；同步進行中不可變更，以避免競態。網站修改不會回寫 Google 試算表。

Calibration lookup supports editing current parameters, deleting one row, and deleting selected rows on the current page (up to 200). Admins and calibration managers can make changes; historical versions are read-only. Editor timestamps use UTC and an exclusive end boundary. Changes create immutable source versions, retain audit history and completed results, and pause source synchronization while keeping enabled coefficients usable. Manually edited rows display the editor and timestamp. A source-level Allow synchronization to overwrite manual changes checkbox enables subsequent manual and scheduled imports of corrected spreadsheet data, including restoration of deleted rows. Unchecking restores protection; new edits or deletions reset this consent. Preference changes are audited and blocked during an active sync. Failed synchronization retains current manual parameters and the saved preference. Without persistent consent, explicit one-time replacement remains available. Batch changes are atomic, and stale versions or sources being synchronized cannot be modified. Deletion requires `DELETE`, does not extend remaining intervals, and does not write back to Google Sheets.

- 伺服器啟動的 instrumentation 會註冊每分鐘排程檢查，每個啟用來源每日臺灣時間 02:00 同步。停機錯過的排程會在啟動後第一輪補查；新增來源也會在下一輪檢查。同步失敗保留舊版本並記錄原因，次日再試，可隨時手動重試。
- 必要欄位（不分大小寫）：`aslung_id, PM, slope1, intercept1, Start_date`；選填 `End_date, break_point1, slope2, intercept2`，品質指標保留供查詢。`Factor_*` 暫不使用。
- `PM1, PM2.5, PM10` 分別對應 G3；`PM1_GSA, PM2.5_GSA, PM10_GSA` 對應 GSA。`PM125` 明確保留為僅供查詢，不對應原始量測欄位，也不參與校正計算。其他合法通道名稱以 `UNMAPPED:` 保留，僅供查詢，不猜測或參與計算。
- 日期 `YYYY/MM/DD` 與 `YYYY-MM-DD` 以臺灣時間解讀，Start_date 含當日零時，End_date 含整個當日；含時區的 ISO 日期時間可精確指定。資料庫以 UTC 儲存，區間使用 `[start,end)`。同設備同通道未填結束日期時，適用至該來源下一筆開始時間的前一刻，新舊參數無縫銜接；資料庫直接儲存下一筆開始時間作為排他上限，畫面顯示前一刻。若下一筆只填日期（臺灣當日零時），前一筆自然適用至前一天結束。最後一筆無限期。同一來源、設備與通道的舊 End_date 若只填日期且等於下一筆開始日期（臺灣零時），視為正常同日交接：新參數當日生效、舊參數截止前一刻。原表日期與銜接原因保存在 source_start/source_end/boundary_note 並顯示於查詢。跨日重疊、明確時間重疊、重複開始時間、跨來源重疊或格式錯誤仍拒絕整次更新。單筆開始及結束日期同日而沒有交接時，仍適用整天。
- 單純係數模式公式：`calibrated = slope × raw + intercept`。依 Python 分段慣例，有完整第二段係數時，`raw < break_point1` 採第一段，等於或大於時採第二段；未填第二段全程採第一段。此模式保留負值；完整六項處理模式則將負校正值設為缺值。缺係數、原始值無效、衝突及計算溢位回傳 null 並標記狀態。
- 「資料查詢 → 資料校正」可選原始值或「原始值＋校正值」，支援分頁、單機下載及批次 ZIP。校正結果新增 `*_calibrated`、`*_calibration_status`、`*_calibration_version`、`*_calibration_record` 欄位，原欄位不變。API 預設 raw；使用 `calibration=both`，回傳 `calibration_snapshot`，下一頁帶回此參數可固定版本。同一次下載從開始到結束採同一份參數快照；歷史快照仍受既有設備／期間授權約束。

私人 Google 表單建議啟用 Google Sheets API，建立唯讀服務帳號並將各來源表單分享為「檢視者」。伺服器設定 `GOOGLE_CALIBRATION_CREDENTIALS=/secure/path/service-account.json`（憑證檔放在專案外且限制權限），或用部署平台秘密設定 `GOOGLE_CALIBRATION_CREDENTIALS_JSON`。系統僅申請 `spreadsheets.readonly` 範圍，不使用個人登入 Cookie，也不寫回 Google。沒有設定服務帳號時使用可供伺服器讀取的 CSV 匯出；無權限、HTML 登入頁、逾時與過大回應均視為失敗。不要將憑證或金鑰提交 Git。

測試：`node --test tests/calibration.test.mjs tests/calibration-google.test.mjs`。

同步會完整解析表單，一次列出所有可判定的欄位錯誤、日期錯誤、重複開始時間、來源內與跨來源的期間衝突，附上設備、通道及原表列號；報告不截斷，可在來源卡片捲動查看或下載完整文字檔。有任何錯誤時整批不匯入，保留先前成功版本。CSV 結構損壞或缺少必要標題時，需先修正結構才能檢查資料列。


### 會員角色與設備管理權限

系統管理員在「會員管理 → 角色與權限」設定下列角色。既有 `admin` 仍為系統管理員，`member` 顯示為研究會員，不改動任何既有資料授權。

| 儲存角色 | 顯示名稱 | 權限 |
| --- | --- | --- |
| admin | 系統管理員 | 全部會員、設備、校正、系統設定及資料 |
| device_manager | 設備管理員 | 僅修改明確指定設備的狀態、部署、負責人及維修；量測查詢／下載仍依原資料授權 |
| calibration_manager | 校正管理員 | 全部校正來源、同步、參數及歷史版本；量測資料仍依原資料授權 |
| member | 研究會員 | 依設備、地點及期間授權查詢／下載；維護人員既有維修責任權限保留 |
| viewer | 檢視會員 | 依原授權查詢，禁止資料下載、批次匯出及維修寫入 |

設備管理範圍獨立保存在 `member_device_scopes`，沒有指定設備時不得修改任何設備；不會從資料讀取授權自動推導寫入權限。設備管理頁不提供刪除設備、修改會員、匯入設備或變更資料授權。角色及範圍儲存於同一 SQLite 交易，`member_access_events` 保留前後狀態、操作人員與時間。權限調整於下一次 API 請求生效，快速設備更新會在寫入交易內再次確認管理權限。自己不能修改自己的角色或管理範圍，至少保留一位啟用中的系統管理員。

舊版雙角色 CHECK 約束會在資料庫啟動時升級，保留會員欄位、索引、登入紀錄、工作階段、授權及其他外鍵資料，升級失敗則回復交易。Docker 內備份與帳號 CLI 所需的權限模組一併打包。正式部署前仍應執行既有備份程序。角色變更不取代註冊 Email 驗證與管理員審核。

### 背景清理與校正（第一版）

系統管理員可在「校正管理 → 背景清理與校正」輸入設備、臺灣時間日期區間與第六項 `up_limit`，建立每日工作、重算新版本、啟用／停用每日排程、查看進度與品質摘要、分頁查詢及串流下載 CSV ZIP。結束日期不包含當日；每次最多 31 天，工作內部採 `[start,end)`。沒有適用係數時不建立工作，`up_limit` 預設為 3，可手動調整；API 未提供此參數時同樣使用 3。第一版工作總覽與建立功能僅供 admin；結果 API 每次驗證設備、期間及實際使用的前後背景樣本授權，viewer 可查詢但不可下載；背景樣本超出會員授權時不提供該預先計算結果。既有「資料查詢」的單純係數模式仍保留；完整六項結果由本工作區提供。

校正工作記錄提供設備 ID、工作期間（臺灣日期，結束日期含當日）及狀態篩選，每頁 20 筆，不再僅顯示最近 100 筆。清單只顯示設備、期間、狀態、儲存狀態與筆數，點「詳細資料」查看規則版本、原始欄位版本、up_limit、品質摘要、錯誤與背景樣本期間。詳細資料先讀取資料庫中的工作資訊，管理員點「載入結果預覽」才讀取成果檔，每頁最多 200 筆；單日 CSV ZIP 下載亦集中於此。一般期間查詢及批量下載請使用「資料查詢」。

管理員可在工作記錄的「清除校正成果」依已套用的設備／日期／狀態篩選，點「預覽清除範圍」。範圍涵蓋所有分頁，每批最多 500 個工作；預覽列出本機檔案、S3 所有版本與刪除標記的數量及大小，排除處理中、正在上傳或已排入清除的工作。預覽有效 15 分鐘，綁定管理員與當時的工作／上傳狀態。確認需輸入 `DELETE`，預設勾選停用全域與所選設備的單台排程，避免成果重新產生。

確認前自動備份 SQLite 至 `BACKUP_PATH/before-cleanup-<預覽ID>.sqlite`；備份失敗不會排入清除。此備份只包含資料庫，不包含即將永久刪除的成果檔。背景 worker 將工作標記 `DELETING`，依各工作專屬 S3 路徑刪除所有物件版本與刪除標記並驗證已清空，再刪本機成果及對應暫存檔，最後移除工作、上傳佇列與引用該工作的查詢快照。預覽與清除記錄保留供稽核，成果目錄保留少量 `.deleted` 標記，以阻止進行中的 S3 還原重新產生檔案。原始 MySQL 量測、會員、設備與校正係數不變；使用者電腦已下載的 ZIP、備份、無工作記錄的孤立檔案與 `processed/_checks/` 驗證小檔不在此範圍。

S3 權限不足、部分刪除失敗、本機檔案無法刪除時，工作維持 `DELETING`，清除記錄顯示 `RETRY` 與原因；未成功刪除的本機檔案及工作參照保留，worker 以 30 秒起、最長 1 小時退避重試，亦可按「立即重試」。清除依持久租約執行，中斷後可恢復；worker 未啟動時清除會停留在等待狀態。清除成功後需重新計算才能再次下載成果，排程不會自動恢復啟用。

S3 清除須在現有 EC2 Role **額外新增** `scripts/iam-calibration-cleanup.json` 的補充政策，不可取代既有讀寫政策。範例已限定儲存貯體 `aslung-calibration-prod-20261020` 的 `processed/*`，不同環境需修改該儲存貯體名稱；新增 `s3:GetBucketVersioning`、限定前綴的 `s3:ListBucketVersions`，及 `s3:DeleteObject`／`s3:DeleteObjectVersion`。不需建立長期 Access Key。預覽只盤點，不會測試刪除；若只有列出權限、沒有刪除權限，確認後會顯示權限錯誤並保留工作供重試。Object Lock／MFA Delete 等額外限制不會被繞過。參考 [AWS 列出版本權限](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectVersions.html) 與 [刪除物件及版本](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObjects.html)。

處理順序：

1. G3／GSA 分別處理：三個原始 PM 完全相等且 >50 時清除三者；各通道 <1 時清除該通道。
2. Ghost Peak 完整依 `cleanPM.py`：PM2.5 前向、反向各取五筆平均並迭代五輪，比例 <10 才保留；任一方向保留即保留，雙向都缺值時清除同組三個 PM。PM1／PM10 使用第一項清理後的數值，修正原 Python 重新帶回低值的問題。
3. temperature、rh、co2 <1 設為缺值。
4. 以清理後 PM 套用當時適用的係數；等於分段點使用第二段；負校正結果設為缺值。
5. 校正後 PM1 > PM2.5，將最終 PM1 限制為 PM2.5；兩者皆有效才判斷。
6. 使用同組原始三個 PM：PM1 >50 且 `abs(PM1-(PM1+PM2.5+PM10)/3) <= up_limit`，同組三個最終 PM 皆設為缺值。原始值不完整時留下無法判斷標記。

原始欄位保留，另附 `*_clean`、`*_calibrated`、`*_final`、`_quality`、係數記錄／版本與 `_processing_version`。`*_calibrated` 是第四項結果，`*_final` 包含第五、六項。品質摘要是各欄位旗標出現次數，同筆資料可有多個旗標，不能直接相加當作刪除列數。不刪除原始資料列。

`six-rules-2` 支援資料庫回傳的十進位數字字串（含小數、科學記號及前後空白），計算前轉為有限數值，輸出仍保留原始欄位及型別；空白、無效文字與非有限值仍標記 `INVALID_RAW`。舊版 `six-rules-1` 工作保留原本計算行為，已儲存的結果不會自動改寫。部署後，曾因數字字串而產生空值的期間請使用「重新計算新版本」重新建立工作；新工作的規則版本與快取鍵不同，不會沿用舊結果。

「原始值＋即時計算係數」也使用共用的 `measurementNumber` 解析有限十進位數字字串，保留原始欄位與單純係數模式的負值結果；缺少係數時顯示 `NO_FACTOR`，而非因數字字串誤報 `INVALID_RAW`。此模式在查詢或下載時直接計算，部署修正後重新查詢並下載即可，不需重跑背景工作；已下載的舊檔不會自動更新。

新建立的工作以 `rawSchema: all-fields-1` 固定完整原始欄位版本，保留 `rawdata` 所有欄位（時間轉為 `timestamp`），並附電池、加速度、GPS、氣壓、噪音及粒徑數量等易讀欄位名稱；原始 `ch*` 欄位仍保留。原始資料查詢亦提供完整欄位。舊成果不會從 MySQL 即時補欄位，歷史期間需「重新計算新版本」才能取得完整成果；混合新舊成果下載時，CSV 合併所有欄名，舊檔沒有的欄位留空。

「資料查詢 → 查詢條件」提供「欄位資料說明」按鈕，依網站語言另開中／英文說明頁，整理原始欄位、三種查詢模式、清理／校正／最終值、品質旗標及下載時間與命名。說明頁可直接下載自包含 HTML 文件供離線閱讀，或使用列印另存 PDF。靜態文件位於 `public/docs/ASLUNG_Data_Fields_ZH.html` 與 `ASLUNG_Data_Fields_EN.html`；修改 `scripts/generate-data-field-guide.mjs` 後執行 `node scripts/generate-data-field-guide.mjs` 更新兩份文件，`--check` 可檢查文件是否與來源一致。

下載 ZIP 與內部資料檔使用設備 ID 與臺灣日期，例如 `AL-1143_20261001.zip` 或 `AL-1143_20261001_20261031.zip`。單日背景工作結束時間不包含次日零時，檔名只顯示當日；資料查詢包含結束時間，檔名依實際查詢端點日期。每日儲存仍維持獨立成果，資料查詢可合併整段期間為一份 CSV。多設備／多區段下載仍為單一 ZIP，各區段檔名附 `segment-編號` 避免覆蓋，並保留下載清單。

批次 ZIP 的 `download_manifest.txt` 固定提供中英文對照，包括匯出時間、顯示時區、所選期間、模式、各檔案與授權區間、成功／略過／失敗及總計。附三種模式與校正狀態說明，明確解釋 `NO_FACTOR` 是「設備、通道及量測時間找不到適用係數」；原始值保留、校正值留空，不代表 0。匯出成功不代表所有通道都有校正值。伺服器傳回的原始錯誤訊息保留原文供追查。

工作建立時固定完整係數快照、規則版本與 up_limit。相同請求可重用同一工作；補傳或修正原始資料後，請按「重新計算新版本」。獨立 worker 一次執行一個工作，以 2,000 筆區塊處理、各加前後最多 25 筆樣本；使用 keyset 分頁讀取 MySQL，不寫入 rawdata。前後背景不足時 `_background_status=INSUFFICIENT_CONTEXT`，後續補算可產生新版。目前依 Python 使用相鄰樣本，不額外依時間間隔切段。

結果第一版採每個工作一個 gzip JSON Lines 檔，放在 `CALIBRATION_RESULT_DIR`，預設是 DATABASE_PATH 同目錄的 calibration-results；SQLite 僅存工作與摘要。這是可試跑的分批架構，尚未導入 Parquet／S3；多設備合併 ZIP 由資料查詢頁提供。CSV ZIP 串流輸出；查詢每頁 200 筆，目前需循序掃描該日壓縮檔，後續大量互動查詢可換 Parquet／索引。檔案未設定自動清除策略，部署前需依實測規劃儲存容量與保留年限。

每日排程預設不啟用。啟用後 worker 在臺灣時間 03:00 後排入最近三個完整日，涵蓋例行補傳；更早的資料補傳或歷史係數修正需手動重算。停機期間不自動補齊全部歷史日期。結果寫入暫存檔後，完成才發布；工作有租約避免重複執行，中斷最多自動重取三次，失敗可手動重試。

本機另開 PowerShell，使用與本機網站相同的隔離資料庫：

```powershell
.\scripts\start-local-calibration-worker.ps1
# 單次處理一個工作：
.\scripts\start-local-calibration-worker.ps1 -Once
```

請先確保 `.env` 中的 MYSQL_HOST、MYSQL_USER、MYSQL_DATABASE、MYSQL_PASSWORD 正確；原始資料為唯讀查詢。本機結果存放 `.tools/calibration-results`，不會提交 Git。Linux／EC2 可設定 DATABASE_PATH、CALIBRATION_RESULT_DIR 後執行 `npm run calibration:worker`。Docker 使用與網站共享的資料 volume，需另外啟動：

```bash
docker compose --profile calibration up -d --build calibration-worker
```

測試：`node --test tests/processing.test.mjs tests/calibration.test.mjs tests/calibration-google.test.mjs`。Ghost Peak 含由使用者提供的 Python 函式實際執行產生的 240 筆對照資料；另驗證分批等價、六項邊界、租約、原子發布、失敗重試、排程與下載權限。

### 全域自動校正排程

「背景清理與校正」新增全域開關與獨立的 up_limit（預設 3），僅 admin 可設定。功能安裝時預設關閉；啟用一次後，每天臺灣時間 03:00 後由 worker 自動掃描，不需逐台建立排程。全域開關、參數、最近掃描時間、設備／工作數及錯誤均持久化於 SQLite。

候選設備為已登錄且具有可計算通道係數的設備；不以線上／離線或部署狀態排除。MySQL 每批最多 100 台，唯讀彙總最近三個完整日及當日截至掃描時間的資料；只為有量測資料、且該日有適用係數的完整日建立工作。當日資料僅偵測新增與背景更新，不產生尚未結束的當日檔。以 rawdata 自增 id 的高水位辨識新增／補傳，並記錄各設備每日已排入的資料與係數／規則版本；相同資料不重複建立工作。停止上傳的設備，前一天尚未排入的資料仍會處理。近期資料或係數／up_limit 更新時，受此次掃描涵蓋的完整日會產生新版本。此機制不偵測原始資料原地修改或刪除，需使用手動重算。

已啟用單台排程者使用單台設定，全域掃描略過，避免雙重排程；單台排程停用不等於全域排除。全域停用只停止新增自動工作，既有排隊工作仍會繼續。較早於最近三個完整日的補傳或歷史係數變更，仍需手動建立區間工作。worker 中斷或 MySQL 暫時失敗時保留掃描錯誤，五分鐘後重試；設定變更會取消尚未發布的掃描結果，重啟不會重複排入同日已完成的掃描。

### 在資料查詢下載已完成校正結果

「資料查詢 → 資料校正」新增「已完成清理與校正（六項規則）」；此模式直接讀取背景結果檔，不連線 MySQL 重新計算。保留原始值、`*_clean`、`*_calibrated`、`*_final`、品質旗標，另附 `_processing_job_id` 與 `_processing_up_limit`。可分頁查詢、下載 CSV／JSON，既有多設備／追蹤區段 ZIP 也沿用此選項。`*_final` 才是全部六項規則後的最終值。

跨日結果自動合併；重疊版本採最新完成的結果，查詢時建立結果快照，後續分頁與下載帶回 `calibration_snapshot=processed:<uuid>`，避免中途混入新發布版本。每次仍重新檢查設備、區間與 Ghost Peak 背景授權，viewer 無匯出權限。若任何授權區間尚無完整結果，API 回傳 409 並列出缺漏（UTC），不提供部分檔、不改用原始值；管理員可至背景工作補算。沿用原資料 API 的包含結束時刻語意，例如查到下一日 00:00:00 時，也需要涵蓋該時刻的結果。背景模式與即時單純係數計算為不同選項。

### CSV ZIP 伺服器壓縮下載

資料查詢頁新增「CSV ZIP（伺服器壓縮）」按鈕，原始值、即時計算係數及已完成六項結果皆支援。API 使用 `download=1&format=csvzip`；伺服器分批讀取並串流產生包含 UTF-8 CSV 的 DEFLATE ZIP（level 1），不先把全部 CSV 載入記憶體、不在伺服器產生暫存檔。量測資料檔案下載僅提供 CSV ZIP／JSON ZIP，保留授權與校正快照檢查。

多設備使用此選項時，每台先接收伺服器壓縮資料，以減少網路傳輸；瀏覽器解壓並合併 CSV 與清單為一份壓縮 ZIP，不會產生巢狀 ZIP。原有多設備 CSV／JSON 打包也改用 DEFLATE 壓縮最終檔案。批次最後合併仍使用瀏覽器記憶體，超大批次請分次下載。

第一版採 ZIP32，單份 CSV 或 JSON 未壓縮大小上限為 2 GiB，超過請縮短區間；串流期間若資料來源失敗或超過上限，下載會失敗，避免把截斷的 ZIP 當作成功。取消下載會關閉來源串流。尚未加入下載檔快取或背景 ZIP 產檔。

測試：`node --test tests/csv-zip.test.mjs tests/batch-download.test.mjs tests/processing.test.mjs`，包含 CRC 解壓驗證、中文／BOM、壓縮效果、大小限制、取消與失敗處理、原始分頁讀取、校正結果壓縮及批次合併。

### 量測資料下載統一 ZIP

資料查詢僅提供「CSV ZIP」與「JSON ZIP」；背景校正工作結果下載為 CSV ZIP。所有量測下載均由伺服器先進行 DEFLATE 壓縮後傳輸。`/api/data?download=1` 使用 `format=csvzip` 或 `format=jsonzip`；舊網址 `format=csv`、`format=json` 亦統一回傳 `application/zip`，不再提供未壓縮匯出。未指定 format 的下載回傳 JSON ZIP。既有串接程式若使用 download=1，必須先解壓再讀取內容；一般分頁 JSON 查詢（不帶 download=1）維持原介面。

CSV ZIP 內含一個 .csv，JSON ZIP 內含一個 .json，JSON 仍保留設備、授權期間、校正快照與 data 欄位。批次下載先接收每台設備的伺服器 ZIP，再合併為單份 ZIP（CSV／JSON 與清單並列，無巢狀壓縮檔）。不包含檔案專區、附件、QR 圖片及錯誤報告等其他下載功能。下載仍需原本的設備／期間／背景資料授權；viewer 僅能查詢。
### 部署校正分支到 EC2

部署前及回退前可先執行完整的「本機應用程式備份」（需要短暫停止網站與 worker）：

```bash
cd ~/aslung-deployment/aslung_data
sudo bash scripts/backup_ec2.sh
# 指定專案外的備份磁碟目錄；映像較大，請事先確認磁碟空間。
sudo bash scripts/backup_ec2.sh --output /mnt/backup/aslung
# 省略容器映像（回退時必須另有映像或重新建置）：
sudo bash scripts/backup_ec2.sh --skip-images
```

預設備份至專案上層的 `aslung-backups/<UTC時間>-<程序編號>/`，每次使用新目錄，不覆蓋或自動刪除舊備份。包含獨立且完成完整性檢查的 `aslung.sqlite`、`app-data.tar.gz`（整個 `/app/data`：含本機校正／HOBO 資料、上傳檔及原資料庫檔）、`.env`、`compose.yaml`、Git HEAD 程式封存與已追蹤修改補丁，以及目前實際容器映像（預設包含）。`git-commit.txt` 是目前 checkout 的版本，不一定等於已部署映像；`images.txt` 記錄實際容器映像 ID。未追蹤／ignored 原始碼、遠端 MySQL、S3 物件、EC2 主機設定、外部憑證檔與既有備份 volume 不在範圍內；雲端資料需另有獨立備份策略。

腳本與部署共用鎖，拒絕同時執行。先保存設定／映像，再停止原本運行的寫入服務，以原容器映像及唯讀掛載讀取 SQLite 和 `/app/data`，不匯入應用程式或觸發 schema migration。備份完成／失敗均嘗試以原容器恢復運行，不重新建立容器、不更新 Git、不刪除 volumes；失敗會保留未完成檔案供檢查。只有封存檔、SQLite、SHA-256 檢查及服務恢復成功後才留下 `COMPLETE`。意外斷電或 SIGKILL 無法執行復原處理，需自行檢查並恢復容器。

在備份目錄執行 `sha256sum --check SHA256SUMS` 驗證檔案未變動，並確認存在 `COMPLETE`；將整份目錄另存到其他電腦或受保護儲存空間。目錄限制為 700、檔案為 600，包含 `.env` 密鑰，不可提交 Git 或公開分享。還原須另行停止寫入服務，將本機檔案與資料庫作為同一份快照處理，依 `database-path.txt` 確認資料庫位置；不得在網站運行中直接覆蓋 SQLite。此腳本只備份，不執行還原。

在既有 Ubuntu EC2 專案中取得 `scripts/deploy_cal.sh` 後執行：

```bash
bash scripts/deploy_cal.sh
# 需要停用 Docker 建置快取時：
bash scripts/deploy_cal.sh --no-cache
```

此腳本固定部署 `codex/calibration-management`，不呼叫固定切回 main 的 `deploy.sh`。使用 fast-forward 更新；本機有未提交修改、其他未追蹤檔案或分支分歧時停止，不自動 stash／reset。可先把腳本複製到舊 checkout，唯一允許的未追蹤檔案為 scripts/deploy_cal.sh。

流程為設定系統服務開機啟動、驗證 Compose、建置網站與 worker、停止舊 worker、以直接唯讀開啟 SQLite 的方式建立升級前備份並檢查完整性、更新網站並等待健康檢查、先以單一短連線驗證 MySQL 唯讀查詢、關閉驗證連線，再啟動 worker 並確認容器穩定性。建置與備份期間不停止既有網站。即使 Git 無更新也執行檢查與部署，預設使用 Docker 快取。失敗不會自動還原資料庫或刪除 volumes；若網站更新前已停止 worker，修正問題後重跑腳本。

適用已有正式 SQLite 的環境；資料庫與校正結果需位於共用 /app/data，備份位於 /app/backups，並沿用原 Compose 專案／volumes。若找不到既有資料庫或環境路徑未持久化，腳本會停止。備份檔為 /app/backups/before-cal-*.sqlite，保留在 aslung-backups volume，備份本身不觸發新版 schema migration。排程開關沿用資料庫設定，部署腳本不會自動啟用全域／單台排程。

### 會員與維護人員的明確關聯

管理員至「會員管理 → 維護身分關聯」勾選會員代表的維護人員，可關聯多個身分，也可設定自己的管理員帳號。相同 Email 僅提示建議，不自動勾選；同名、共用信箱不會自動取得新區塊權限。待審核帳號需先完成審核。關聯以 members.user_id 與新增的 maintainer_id 保存，變更會留下稽核紀錄，並以 revision 防止覆寫其他管理員剛儲存的設定。

登入後於「即時線上狀態」上方顯示「我的維護設備」：總數、連線中、已斷線、從未回報、無法確認，以及設備、地點、維護人員、最後回報與斷線時間。每分鐘更新，沿用系統斷線門檻。只回傳目前有效的責任紀錄；交接時以同設備最新有效紀錄為準，過期、未開始或移出的紀錄不提供狀態權限。SQL 查詢失敗顯示未知，不誤判為離線；從未上傳或斷線超過一年保留警示，但不寄送告警。解除關聯或停用帳號後，在 API 回傳前也會重查授權。

新增 maintainer_id、device_locations.maintainer_id 與關聯資料表，保留既有內容；新增／更新追蹤紀錄的維護姓名時由觸發器維持 ID，英文稱呼、Email 更新不改變關聯。刪除維護人員會解除其關聯，重建同名人員會取得新 ID，不繼承舊權限。Google 表單若以全新中文姓名新增一列，仍視為新身分，需管理員確認關聯。

採用會員關聯的維護身分，告警收件人改為關聯的啟用會員，並尊重各會員的告警收信開關。即使最後一筆關聯被移除，也不會退回原聯絡 Email 繼續寄信。從未採用明確關聯的維護人員，保留既有信箱寄送流程；測試信箱仍受主要收件人收信資格限制。這些設定不會修改角色、既有 grants 或既有資料查詢／下載授權；既有姓名／Email 對應流程維持，新區塊及新增關聯不會自動增加量測下載權限。

測試：`node --test tests/maintainer-links.test.mjs tests/alerts.test.mjs tests/member-view.test.mjs`。

### 校正匯入紀錄與下載

「校正管理 → 匯入紀錄」以表格顯示每次同步的時間、來源、結果、筆數、版本與執行者，可分頁、點擊列或「詳細資料」開啟完整報告、全部錯誤與衝突、當次版本係數。詳細視窗提供「編輯來源設定」、日誌備註及 ZIP 下載。只有系統管理員與校正管理員能查詢、下載及編修。

新增的同步紀錄會保存當次來源名稱、網址、說明、係數版本、原始 CSV 與結構化錯誤清單；CSV 以 gzip 壓縮並依內容雜湊共用，未變更的每日同步不重複儲存同份檔案。下載 ZIP 依資料是否存在包含 metadata.json、report.txt、source.csv、issues.csv、coefficients.csv。失敗匯入不會附上前一版係數；來源取得失敗時只有報告。舊日誌仍可檢視與下載原有報告，但不推定其版本，也不以目前表單取代歷史檔案。

編輯日誌僅修改備註，使用 revision 防止互相覆寫；原始結果、錯誤訊息及時間不被覆寫。單筆或批次刪除會移除日誌及不再被其他紀錄引用的下載快照，保留係數版本、目前套用設定與已完成的校正結果。備註編修及刪除均留下操作稽核。

刪除來源採封存：從來源清單移除、停用每日同步與後續係數套用，保留歷史版本、匯入紀錄及已完成結果；正在同步時拒絕刪除。日誌詳細資料仍可查閱已刪除來源的匯入快照。操作前有確認視窗，與「只刪除日誌」的影響不同。

測試：`node --test tests/calibration-history.test.mjs tests/calibration.test.mjs tests/processing.test.mjs tests/global-processing.test.mjs`。

### S3 校正成果儲存（第一階段）

預設仍為本機模式。EC2 的 app 與 calibration-worker 共用 `.env`，啟用東京 S3 時加入：

```dotenv
CALIBRATION_STORAGE=s3
AWS_REGION=ap-northeast-1
S3_BUCKET=aslung-calibration-prod-20261020
```

透過 AWS SDK 預設憑證鏈取得 EC2 IAM Role 憑證，正式環境不需將 Access Key 寫入 `.env`。EC2 使用私人 S3 儲存貯體、ACL 停用、SSE-S3，角色需具備 `processed/*` 的 GetObject、PutObject、AbortMultipartUpload、ListMultipartUploadParts。Docker 使用 IMDSv2 required 時，主機 metadata response hop limit 設為 2，且須能連線至 IMDS 與東京 S3。正式資料庫、本機結果目錄與備份磁碟區沿用既有設定。

新校正工作先原子發布本機 gzip JSON Lines，保存 SHA-256 與大小，再於同一筆交易新增 S3 上傳工作。物件路徑為 `processed/<設備>/<臺灣日期 YYYY/MM/DD>/<工作 UUID>/<SHA-256>.jsonl.gz`；工作已固定係數及清理規則快照，不同校正版本不會覆蓋舊成果。上傳採 SHA-256 校驗，之後以 HeadObject 核對大小、檢查碼及 metadata，通過後才在資料庫發布 S3 路徑。

S3 故障不會將已成功校正的工作改為失敗，也不重算資料。上傳佇列保存在 SQLite，worker 重啟後可繼續；失敗從 30 秒開始退避，最高每小時重試一次。獨立上傳租約防止重複發布。管理員可在「背景清理與校正」查看等待上傳、上傳中、等待重試或 S3 已驗證，錯誤不輸出憑證。單一成果使用 PutObject，限制為 5 GiB；超過需縮短工作區間，第一階段尚未實作大型成果 multipart 上傳。

既有查詢與 CSV ZIP／JSON ZIP 下載維持原本授權及操作流程。當本機檔案存在時先讀本機；若缺少且有已驗證的 S3 路徑，則下載至共用結果目錄，核對預期大小與 SHA-256 後才原子發布並讀取。下載中斷、缺件或檢查碼不符會清除暫存並回報錯誤，不回傳截斷的結果；每筆背景工作仍驗證查詢期間及 Ghost Peak 前後背景資料授權。

`scripts/deploy_cal.sh` 在建置映像後、停止既有 worker 前，執行 `scripts/check-calibration-s3.mjs`。local 模式只確認設定；s3 模式實際上傳小型測試成果、驗證大小與檢查碼並讀回，未通過即停止部署。測試物件保留於 `processed/_checks/`，可由管理員在 S3 Console 定期清理；程式目前不需要 DeleteObject 權限。部署完成後仍可手動檢查：

```bash
sudo docker compose exec -T app node scripts/check-calibration-s3.mjs
sudo docker compose --profile calibration logs --tail=80 calibration-worker
```

第一階段不自動搬移既有歷史工作、不刪除本機結果、不啟用排程，也不建立 S3 ZIP 下載快取或預簽署連結。已完成成果的查詢及下載仍經由 EC2，這一階段尚未減少瀏覽器下載所經過的 EC2 流量，也尚未釋放本機成果空間。請先使用一台設備的一天資料完成正式環境驗證，再加入歷史搬移、容量清理與直連下載。

測試：`node --test tests/processing-storage.test.mjs tests/processing.test.mjs tests/calibration.test.mjs tests/deploy-cal.test.mjs`。S3 SDK 使用測試替身驗證上傳內容、完整性、重試及本機還原，不使用正式 AWS 憑證或正式資料庫；實際權限需以 EC2 部署前探測驗證。

### 小容量 EC2 建置記憶體

Docker builder 階段預設設定 `NODE_OPTIONS=--max-old-space-size=1024`，並傳遞給 Next.js 的 TypeScript 檢查子程序。Compose 的 app 與 worker 共用 `NODE_BUILD_HEAP_MB` 建置參數，可在 `.env` 調整，預設 1024 MiB；runtime 階段不繼承 builder 的 Node.js 堆積設定。Next.js 限制單一建置 worker 並啟用 Webpack 記憶體最佳化，仍保留正式建置的 TypeScript 檢查。

約 1 GiB RAM 的 EC2 即使有 swap，建置仍可能較慢；提高堆積上限不會增加實體 RAM，也不能保證避免主機 OOM。部署前可用 `free -h` 檢查 RAM／swap、`df -h` 檢查磁碟。若持續出現程序被系統終止（如 exit 137），需評估主機容量或改由 CI 建置映像；不要關閉型別檢查來繞過建置失敗。


### HOBO / LI-COR 設備資料

支援 24 台 RCEC 設備批次設定、歷史匯入、每小時同步、查詢與 CSV 下載，以及 S3 按設備日歸檔和本機／S3 同步清除。設定與操作請見 [HOBO / LI-COR 說明](docs/HOBO-LICOR.md)。實際 Token 僅設定在 EC2 `.env` 的 `LICOR_API_TOKEN`；啟用 S3 使用 `HOBO_STORAGE=s3`，清除權限另新增 `scripts/iam-hobo-cleanup.json`。

### 最新消息與文章發布

側邊欄「最新消息」與「文章專區」供登入會員閱讀；admin 可新增、預覽、儲存草稿、發布、置頂、編輯及下架。具備搜尋、狀態篩選與分頁，草稿及下架內容不對一般會員開放。資料保存在 SQLite 並納入現有備份。操作及 API 請見 [中英文發布說明](docs/CONTENT-PUBLISHING.md)。

### 檔案專區的外部下載連結

除直接上傳外，admin 可新增外部 http/https 檔案連結、名稱、說明並沿用會員授權。會員點選後先驗證本站權限，再開啟外部平台；本站不抓取或儲存外部檔案。刪除只移除連結與授權，不刪除外部原檔。請另行設定外部平台的分享權限與有效期限。詳見 [檔案與外部連結說明](docs/FILE-RESOURCES.md)。

### 功能列分類與隱藏

側邊欄依「消息與資源、監測與資料、設備管理、校正與告警、會員與權限、資料串接」分組，可點分類標題收合；沒有授權項目的群組不顯示。切換頁面時自動展開目前頁面的群組。群組收合不會離開目前頁面。

頂端工具列提供「隱藏選單／顯示選單」，側邊欄品牌區也有隱藏按鈕。桌機完全隱藏後主內容可使用釋放的寬度；手機使用抽屜，選擇功能後自動關閉。桌機可見狀態與群組偏好按登入帳號保存在本機瀏覽器，與現有選單寬度設定分開；不修改帳號權限。

The sidebar groups functions into news/resources, monitoring/data, device management, calibration/alerts, members/access and data integration. Empty unauthorized groups are hidden. Group collapse preserves the current page; navigating expands its group. The header toggle hides or shows the menu, and mobile selection closes the drawer. Desktop visibility and group preferences are stored per account in the current browser.


### Forgot password / 忘記密碼

登入頁的「忘記密碼」連至 `/forgot-password`，輸入帳號登記的 Email 後，使用既有告警／郵件設定的 SMTP 寄出 `/reset-password` 連結。請先由管理員在「斷線告警監控與郵件設定」設定可用的 SMTP，並確保 `APP_ORIGIN` 是實際網站來源；正式環境使用 HTTPS。未設定郵件服務時顯示 503 提示，不會偽稱已完成寄送。未登記 Email（`@local.aslung`）的帳號須聯絡管理員，既有 `pnpm member:reset-password` 工具保留。

連結 30 分鐘內有效、只能使用一次，最新申請會取代先前連結；資料庫只保存 token 的 SHA-256 雜湊，並綁定會員識別、Email 與當時密碼。管理員重設、CLI 重設、本人改密碼或更改 Email 後，舊連結也會失效。完成前仍可使用原密碼登入；完成後清除該會員所有登入 sessions 及登入失敗鎖定，須以新密碼重新登入，角色、啟用狀態與資料授權不變。

連結 token 放在 URL fragment，不傳給伺服器日誌；頁面讀取後移除 fragment，不寫入瀏覽器儲存空間。GET 不會消耗 token，郵件掃描器不會因開啟連結而改密碼。POST 要求同來源；API 回應不快取。申請對存在、不存在或停用帳號均回覆相同成功訊息，郵件在回應後寄送；寄送失敗會刪除該次 token 並記錄不含收件人／token 的錯誤，使用者可重新申請或聯絡管理員。每小時全站最多 100 次、同來源 IP 20 次，同一 Email 申請最多 3 次。IP 來源沿用既有反向代理標頭，部署時須由可信代理覆寫這些標頭，站台上限仍會限制偽造 IP 的大量要求。

驗證：`node --test tests/password-reset.test.mjs tests/auth.test.mjs tests/registration.test.mjs tests/registration-api.test.mjs`。測試使用獨立 SQLite 與模擬寄信，不寄送真實郵件；正式 SMTP 仍須由管理員確認可收信。

### Host resource controls / 主機資源配置

`compose.yaml` 將網站的 CPU 相對權重設為 1024、背景 worker 設為 256；worker 預設上限為 0.5 CPU、768 MiB 記憶體、128 個程序／執行緒，Node.js old-space heap 上限為 512 MiB，保留空間給 gzip、Buffer 與原生模組。CPU 權重與記憶體上限的意義依 [Docker Compose 官方說明](https://docs.docker.com/reference/compose-file/services/)；上限不代表預留資源，也不保證整台主機不會耗盡記憶體。網站記憶體上限 `APP_MEMORY_LIMIT=0` 預設維持不限制，取得主機數據後再設定，避免直接套用未知容量。可在 EC2 `.env` 調整：

| 變數 | 預設 | 用途 |
| --- | --- | --- |
| `WORKER_CPUS` | `0.5` | worker CPU 上限（0 表示不限制） |
| `WORKER_MEMORY_LIMIT` | `768m` | worker 容器總記憶體上限 |
| `WORKER_HEAP_MB` | `512` | V8 old-space 上限，須低於容器上限並保留原生記憶體空間 |
| `WORKER_PIDS_LIMIT` | `128` | worker 程序與執行緒數上限 |
| `APP_MEMORY_LIMIT` | `0` | 網站可選的總記憶體上限，例如 `1g` |
| `WORKER_BUSY_DELAY_MS` | `2000` | 持續有工作時，每輪完成後暫停 100–60000 ms |
| `WORKER_IDLE_DELAY_MS` | `5000` | 無校正工作時，每輪完成後暫停 1000–300000 ms |
| `WORKER_HOBO_ARCHIVE_DAYS` | `1` | 每輪最多歸檔 1–10 個設備日 |
| `WORKER_CALIBRATION_SOURCES` | `1` | 每輪同步最早到期的 1–10 個校正來源 |
| `WORKER_RAW_BATCH_SIZE` | `1000` | 每批讀取 100–2000 筆原始資料，保留 keyset 與前後樣本 |
| `WORKER_BATCH_PAUSE_MS` | `50` | 量測讀取／全域設備摘要批次間暫停 0–1000 ms |

worker 維持一次一件校正工作；每輪歸檔及係數同步設有數量上限，不會因大量歷史歸檔而在同輪無限執行。減少批次可降低瞬間負載，但也會增加整體完成時間。收到停止訊號後完成當前階段，不再領取下一件工作；輪次間的等待會立即中斷。Compose 給予 120 秒停止寬限，超時仍可能由 Docker 終止，既有 lease／原子發佈與重試機制保留。SQLite 繼續使用 WAL 與原有 busy timeout，不另外啟動第二個 worker。

先在 EC2 專案目錄執行 `node scripts/host-resources.mjs --docker` 取得唯讀 JSON 報告：主機可用記憶體、swap、磁碟、Linux CPU／記憶體／I/O 壓力，以及 app／worker 用量、實際資源限制、OOM 狀態與重啟次數。Docker 讀取需要既有 Docker 權限；無 Docker 時可省略 `--docker`。未支援的 Linux 指標回傳 null，不會被誤判為 0。swap 讀寫是開機以來累積值；比較兩次報告才能判斷是否仍在換頁。EC2 CPU credit、流量與 EBS 額度仍需從 CloudWatch 查看，本工具不存取 AWS 憑證。

設定生效需更新程式與重建／重新建立容器。完成推送後，可在 EC2 使用既有 `bash scripts/deploy_cal.sh` 流程備份並部署 app 與 worker；僅修改 `.env` 而沒有重新建立容器不會套用新限制。部署後再執行唯讀報告，確認實際上限、OOM 與重啟狀態。此處提供部署設定與檢查工具，並未自動修改 EC2 instance 規格、swap、EBS 或正式容器。

### MySQL connection capacity / 連線數容量

工作空間依目前頁面呼叫 `/api/manage?scope=...`，公告及文章頁只取得身分、導覽資格及摘要；會員、授權、告警、檔案與 API 權杖於相關頁面才載入。複合管理對話框可按需載入完整資料；未帶 scope 的舊客戶端維持完整回應。scope 只選擇資料集合，不增加角色或設備權限。讀取工作空間不再批次改寫設備狀態，狀態同步仍由既有設備／部署寫入操作負責。瀏覽器等待頁面偏好還原後才開始載入，快速切頁會取消舊請求並忽略遲到回應。

即時狀態每批最多 50 台，以各設備 `ORDER BY time DESC, id DESC LIMIT 1` 組合成 `UNION ALL`，減少往返，不使用掃描全部歷史的全表分組。每個 Node 程序最多同時執行兩個即時查詢批次；相同設備的進行中查詢與有效期限內的原始量測可共用（預設 120 秒，管理員可在「即時狀態」頁設定 0–3600 秒，0 表示停用已完成量測快取），快取最多 5,000 台。秒數儲存於 SQLite，後續請求立即依新秒數與量測讀取時間判斷有效期，不需重新啟動；與畫面自動更新頻率分開設定。手動更新使用 `refresh=1` 略過已完成快取，進行中請求仍共用；錯誤不快取。每次請求與讀取完成後都重新核對身分及可讀設備，不快取會員權限，也不透過 HTTP 共用快取。實際 MySQL 仍需適當的 `uid,time` 索引及查詢計畫；程式不會自動修改正式 rawdata 索引。worker 資源限制與批次設定見上方「主機資源配置」。

HOBO 搜尋每頁 200 筆，透過 `next_cursor` / `cursor` 接續下一筆符合資料，跳過已讀完的臺灣日期封存檔及本機日期區間。游標綁定設備、起訖時間、正規化篩選及資料 revision；同步、歸檔或清除造成版本改變時，回傳 409 並要求重新搜尋，清除中的範圍回傳 410。每次分頁都重新驗證管理員權限，回應不使用 HTTP 快取。舊版 `after` 數字分頁仍相容，但保留原有掃描成本。CSV 仍下載全部符合條件的資料。S3 每日 gzip 檔案仍須整檔讀取與解壓；同一日期跨頁時會重讀該日，不新增無上限的記憶體快取。

效能與權限驗證：`node --test tests/workspace-performance.test.mjs tests/realtime-discovery.test.mjs`；正式建置後可執行 `node tests/workspace-performance-http.mjs`，使用獨立暫存 SQLite 與 standalone 程序，不連線正式 MySQL。

網站每個 Node 程序共用同一個延遲建立的 MySQL 連線池，預設最多 4 條；校正 worker 預設最多 1 條。可用 `.env` 的 `MYSQL_CONNECTION_LIMIT` 與 `MYSQL_WORKER_CONNECTION_LIMIT` 調整（1–30）。超出保留數的閒置連線會被清理，最多保留一條閒置連線 30 秒；1 條上限時不保留閒置連線。不要將單一程序的上限當作整台資料庫的總上限，多副本與其他應用仍會累加。

部署在啟動 worker 前，以短生命週期單一連線執行 `rawdata LIMIT 0` 唯讀驗證，並確保成功或失敗時關閉已取得的連線，避免 worker 與部署驗證同時佔用額外連線。`ER_CON_COUNT_ERROR` / 1040 表示來源 MySQL 已拒絕新連線，部署會停止，不能僅以網站健康檢查成功判斷資料來源正常。資料庫管理員可檢查 `SHOW GLOBAL STATUS LIKE 'Threads_connected'`、`SHOW VARIABLES LIKE 'max_connections'`、`SHOW FULL PROCESSLIST`，確認連線來源；不要批量終止不明連線或未評估記憶體便直接提高限制。降低 `.env` 上限需更新程式並重建 app / calibration-worker 容器才生效。


### 使用紀錄與安全修補（2026-11-13）

「會員與權限 → 使用紀錄」僅系統管理員可見，API `/api/activity` 亦獨立驗證當前角色。可依臺灣日期（最多 90 天）、類型、會員／事件／IP 搜尋，每頁 50 筆，以紀錄 ID 接續分頁。新紀錄開始時間會顯示在頁面，不將既有頁面載入數推估為歷史訪客人數。

- 登入／密碼：成功、失敗、登出、修改密碼與忘記密碼申請／完成／寄送失敗。登入失敗的輸入識別在「對象」欄顯示，不代表存在該帳號。
- 瀏覽：只由可見、已載入的頁面送出紀錄，不計入健康檢查、API 輪詢或伺服器預載。相同識別與頁面 3 秒內重送不重複計數；30 分鐘沒有新的頁面瀏覽後再訪才算新造訪。登入後以會員識別、未登入以隨機 HttpOnly cookie 識別，資料庫保存匿名識別的 SHA-256，不使用 IP 當作人數。匿名轉登入會切換識別，這些是造訪／瀏覽估計，並非真實人數。
- 重要操作：會員／授權、設備、校正、HOBO 清除、貼文與檔案等寫入 API 的操作者、事件／入口及結果。管理操作另記安全的對象 ID，不保存表單全文；既有各功能的專用歷程仍保留。
- 下載：資料下載、背景處理成果、HOBO CSV 與檔案開啟／下載。記錄回應開始與結果，不宣稱串流已傳輸完畢。既有檔案檢視也列入此類。

明細（含既有 `login_logs`、`site_visit_logs`）保留 90 天，按小批次清理；每日彙總持續保留。新版紀錄不以會員外鍵連動刪除，因此刪除帳號不會抹除其新版操作紀錄。舊紀錄不會回填到新版紀錄頁。頁面與紀錄寫入皆有每分鐘流量上限，紀錄為 best-effort：資料庫故障時不以紀錄錯誤取代業務回應；不能當作不可竄改或保證完整的外部稽核系統。備份內的歷史資料仍須依備份保留政策管理。

`TRUST_PROXY_HEADERS` 預設為 `0`，忽略可偽造的來源 IP 標頭，因此本機／未設定代理時 IP 欄為空，IP 限流也會共用未知來源額度。只有確定網站僅可經由可信代理進入，且代理會覆寫來源標頭後，才在 `.env` 設定 `TRUST_PROXY_HEADERS=1`。單層 Nginx 可將 `X-Forwarded-For` 與 `X-Real-IP` 設為 `$remote_addr`；若有 ALB／CloudFront 多層代理，必須先按實際拓樸設定可信來源，不能直接信任任意客戶端提供的第一個 IP。請維持 Compose 的 `127.0.0.1:3000` 綁定，避免公網直接繞過代理。登入另有全站／IP 每分鐘上限及原有帳號限制；scrypt 每程序最多同時執行 2 件、最多等待 16 件，超額回覆 429。

本次修補：

- 檔案串流回應限制可內嵌 MIME；HTML／SVG 等主動內容強制 attachment + octet-stream，套用 sandbox CSP、nosniff。檔案上傳上限 10 MiB，實際 request stream 亦設上限，不僅信任 Content-Length。
- 三項管理端 Google 同步只接受有效的 `https://docs.google.com/spreadsheets/d/...`，下載重新導向只允許指定 Google 來源，並限制 30 秒與 12 MiB，拒絕內網／metadata URL。
- `cronCheck` 改為管理員專用；一般錯誤不再回傳內部例外訊息，SMTP 密碼不再送回瀏覽器。移除程式內的預設 MySQL 主機／密碼。若正式資料庫曾沿用舊預設密碼，須由管理員另外輪替；刪除目前原始碼不會抹除 Git 歷史。
- 管理員變更會員密碼或 Email 時撤銷 sessions；登入及改密碼流程重新確認憑證，降低重設／停用與舊請求並行的競爭問題。API 權杖仍按既有機制管理，重設登入密碼不會自動輪替 API 權杖；懷疑帳號外洩時須一併撤銷。
- Next.js 升級至 16.4.6，更新 Nodemailer、Zod 與相依套件；fast-uri 3.x 透過 workspace override 固定安全修補版 3.1.9。詳見 [Next.js 官方安全修補公告](https://github.com/vercel/next.js/releases/tag/v16.4.1)。安全掃描以目前 registry 資料為準，不代表未來沒有新漏洞。

安全測試：`node --test tests/activity-security.test.mjs tests/password-reset.test.mjs`；建置後 `node tests/password-reset-http.mjs` 使用獨立暫存 SQLite，驗證真實 API 的角色限制、造訪去重、SSRF、檔案回應標頭、敏感值遮蔽、重設與重新登入，不連線正式網站或寄送郵件。本次範圍為本機程式與依賴檢查；EC2／Nginx／TLS／IAM／資料庫權限、正式 SMTP、備份保存與實際入侵跡象須在部署環境另行確認。


### 研究會員的即時設備授權

研究會員與檢視會員的 `/api/realtime`、即時頁面資料及「我的維護設備」狀態，僅可使用目前有效的個別設備授權，或目前有效地點授權內的當前部署設備。維護身分、同名／同 Email、設備所有權及歷史下載區間，不會自動擴大這兩種角色的即時權限。地點設備以最新已生效的追蹤紀錄判斷，排除已移走、已結束及尚未開始的部署；時間以實際時區比較，舊版僅日期資料以臺灣午夜解讀。

共用量測快取仍只保存原始資料；每次查詢前及讀取後重新計算授權，並檢查量測時間是否落在可讀授權／部署區間。即時頁面只回傳可查看設備的資料與顯示名單，其他頁面既有歷史資料授權維持原設定。管理員的完整即時檢視與其他管理角色原有權限不變。驗證：`node --test tests/realtime-access.test.mjs tests/workspace-performance.test.mjs tests/maintainer-links.test.mjs tests/realtime-discovery.test.mjs`。

### 檔案資料夾、會員群組與期限授權

登入後進入「檔案專區」使用新版檔案管理。這一階段提供單層資料夾、搜尋與每頁 50 筆清單；群組為檔案授權用途，不會改變設備或量測資料權限。

1. 管理員可新增資料夾，在「會員群組」建立群組並勾選成員。群組本身不會自動取得存取權。
2. 選擇資料夾，按「資料夾授權」，選擇個別會員 Email 或會員群組，分別勾選權限並設定生效／到期時間。時間依網站選定時區輸入，後端轉為 UTC；生效含起點、到期不含終點。空白開始為立即，空白結束為不限期。
3. 上傳檔案或新增外部連結時，繼承所在資料夾的授權；也可按檔案的「授權」另外新增個別授權。有效授權取聯集，未授權預設不公開。某份授權到期不會取消其他仍有效的個別或群組授權。
4. 管理員管理所有檔案、資料夾與群組；其他角色只有被明確授予的檔案權限。群組成員名單僅管理員可編輯。

| 權限 | 可執行操作 |
| --- | --- |
| 檢視 | 查看檔名、說明等資訊；PDF、PNG、JPEG、GIF、WebP、純文字及 CSV 可預覽。其他格式僅顯示資訊。 |
| 下載 | 下載原檔；外部連結可開啟原始網址。包含清單可見性。 |
| 管理 | 編輯檔名／說明、永久刪除檔案；資料夾管理另可上傳、建立外部連結與更名。包含可見性，不自動包含下載或授權。 |
| 授權 | 檢查授權名單，新增轉授或撤銷自己轉授的授權。包含可見性，不自動包含下載或管理。 |

轉授必須由一份目前有效、允許轉授的來源授權支援，不得超過其權限或期間；有到期日的來源不能轉授為不限期。非管理員只能選擇自己所屬群組或已存在的個別會員。撤銷來源授權會連動撤銷依賴的轉授；群組移除成員、帳號停用或來源到期時，依賴權限立即失效。每次列出、預覽、下載與異動均由後端重新檢查，不以瀏覽器按鈕或登入時快照作為授權依據。已開始傳輸的內容無法追回。

只有管理員可建立／刪除資料夾與跨資料夾移動檔案。移動會改變繼承權限，直接附加在檔案的授權保留；依賴原資料夾的轉授失去有效來源後不可使用。資料夾須先清空才能刪除，「未分類」不能更名或刪除。檔案刪除仍為永久刪除，這一階段未加入回收桶或檔案版本功能。

預覽與下載使用不同後端檢查；清單不包含磁碟路徑或外部原始網址。僅檢視權限無法取得不支援預覽格式的附件或外部原始連結。不過，瀏覽器能顯示的內容仍可能被另存、擷取或截圖，檢視權限不是 DRM；已開啟的外部網址也無法由本網站追回或撤銷其來源端存取。

資料庫初始化會新增 `file_folders`、`file_groups`、`file_group_members`、`file_permissions` 及遷移狀態表，並在 `files` 加入資料夾欄位。舊檔案歸入「未分類」，既有 `file_grants` 一次性轉為不限期的檢視＋下載授權，保留原先存取；新上傳至未授權資料夾的檔案不自動公開。舊版管理 API 仍重新檢查新版權限，更新舊式會員名單不會刪除新設的資料夾或群組授權。部署前依既有流程備份 SQLite，部署後需重新啟動網站使初始化生效。

驗證：`node --test tests/file-access.test.mjs tests/file-links.test.mjs tests/workspace-performance.test.mjs`；建置後執行 `node tests/file-management-http.mjs`，使用獨立暫存 SQLite、臨時 HTTP 伺服器及測試檔案，驗證真實上傳、群組、四種權限、授權期間、轉授撤銷、外部連結與舊 API 的存取限制，不連線正式資料或寄信。

### 批量撤銷設備／地點資料授權

管理員在「資料授權」可先依會員、授權類型或關鍵字篩選，再逐筆勾選或全選目前篩選結果，按「批量撤銷授權」。變更篩選會清除選取，確認視窗逐筆列出會員、設備／地點與日期；同一介面的單筆撤銷也使用相同檢查。

後端 `revokeBulk` 每批接受 1 至 10000 筆授權快照，在同一交易內重新確認管理員仍啟用，並比對所選授權的會員、類型、標的及起訖時間。任何紀錄已異動／被刪除時整批回覆 409，不執行部分撤銷；資料庫中途失敗亦整批回滾。僅撤銷所選紀錄，其他個別或地點授權維持有效；撤銷地點授權會使設備失去該來源的繼承存取。完成後須重新指派才能恢復授權，這個操作不會刪除會員、設備或量測資料。

驗證：`node --test tests/data-grants.test.mjs` 及建置後 `node tests/workspace-performance-http.mjs`，涵蓋篩選全選、確認內容、權限與來源檢查、資料異動競爭、交易回滾，以及撤銷後即時存取失效。

### 會員角色與一般會員

角色名稱依用途區分，管理角色表示管理職責，不代表線性升級的會員層級：

| 顯示名稱 | 角色代碼 | 開放範圍 |
| --- | --- | --- |
| 一般會員 | `basic` | 最新消息、文章專區、檔案專區；檔案仍按個別／資料夾／群組授權。 |
| 研究會員 | `member` | 依設備、地點與期間授權使用即時狀態及量測資料查詢、下載等研究功能。 |
| 資料檢視會員 | `viewer` | 依既有授權查看量測資料，不能下載量測資料或寫入維修；原名「檢視會員」，代碼與既有權限不變。 |
| 設備管理員 | `device_manager` | 管理指定設備範圍，量測資料須另行授權。 |
| 校正管理員 | `calibration_manager` | 管理校正來源與參數，量測資料須另行授權。 |
| 系統管理員 | `admin` | 全部系統、內容、會員及授權管理。 |

管理員「新增會員」可選一般會員、研究會員或資料檢視會員，表單預設一般會員。既有會員可從「會員管理 → 角色與權限」調整；既有研究會員不自動降級，自行註冊的研究申請流程維持原設定。舊版新增會員 API 未傳 `role` 時維持原本研究會員的相容行為，傳入 `role: "basic"` 可建立一般會員。

一般會員選單只顯示三個資源區塊，直接輸入其他工作空間網址會返回最新消息；變更密碼與自己的合作資料等帳號功能仍可使用。後端限制設備、量測、維修、校正、HOBO、告警、API 串接及管理入口，即使保留舊的設備授權、維護身分或 API 權杖也不能繞過。角色調整不刪除既有資料授權；改回研究角色後，依當時仍有效的授權存取。檔案專區內各操作仍由檔案權限決定，不能藉一般會員身分取得未授權檔案。

啟動時自動擴充舊版二角色／五角色的資料庫限制，保留會員資料、索引、外鍵、登入階段與既有群組和授權。驗證：`node --test tests/member-access.test.mjs tests/registration-api.test.mjs tests/workspace-performance.test.mjs`；建置後 `node tests/general-member-http.mjs` 使用獨立暫存資料庫驗證實際 API、舊權杖、檔案與角色降級行為。

### 富文字貼文與文章圖片

「最新消息」及「文章專區」共用 Tiptap 3 開源編輯器，僅系統管理員可以發文。提供標題／段落、粗體／斜體／底線／刪除線、字型／字級／文字色／底色、上下標、項目符號／編號、引用、對齊、HTTP(S) 連結、表格增刪列欄、常用研究符號及復原／重做。字型使用讀者裝置可用字型，不從外部字型服務下載。可預覽、儲存草稿、發布、下架及重新編輯；預覽不會清除編輯器的復原歷史。

圖片可由工具列選取、貼上或拖曳插入，支援 PNG、JPEG、WebP（非動畫），單張上限 5 MB／1600 萬像素、每篇最多 30 張。圖片替代文字用於閱讀輔助，選填圖說會插入為圖片後的文字段落；點選圖片可拖曳縮放。上傳後由 sharp 解碼、移除原有中繼資料、校正方向並轉為最大 2400×2400 的 WebP，拒絕 SVG、HTML、動畫及無效圖片；不接受外部圖片網址或內文 Base64 圖片。每程序同時處理一張圖片，忙碌回覆 429，每個管理員滾動 24 小時最多上傳 100 張。

文章與最新消息編輯器提供「繁體中文／English」兩個編輯頁，分別保存標題、摘要、Tiptap 內文與圖片；切換頁籤保留尚未儲存的內容。中英文共用發布狀態、置頂、閱讀權限與版本檢查，按儲存時一起套用。公開首頁卡片、公開列表、全文與會員閱讀畫面依介面語言選擇內容；英文尚未提供時保留中文原文，全文顯示提示。英文可先以不完整草稿儲存，發布時若有英文內容則須填妥英文標題及內文。搜尋涵蓋中英文，英文摘要留白時從英文內文擷取。既有資料自動新增 `title_en`、`summary_en`、`body_en`、`body_json_en` 欄位，不翻譯或覆蓋原文；舊版未傳英文欄位的儲存會保留已存英文。中英文合計最多 30 張不同圖片，圖片權限沿用貼文閱讀權限。

對外署名可在兩個語言編輯頁分別自訂，也可留白隱藏。既有及新建文章預設「平台編輯團隊／Editorial team」，不以實際姓名作為對外預設值。真實建立者、發布者與最後編輯者僅管理員管理模式可查看；公開及一般會員 API 不傳送這些內部欄位，公開頁面與會員閱讀畫面僅顯示對外署名。

編輯器提供「插入下載／申請區連結」，依編輯語言插入對應文字及 `/file-catalog?lang=zh-TW` 或 `/file-catalog?lang=en`。連結引導至公開檔案清單與申請流程，個人專屬下載連結仍由管理員審核後寄送。此內部相對連結會隨正式網域運作；其他連結沿用完整 HTTP(S) 網址驗證。

新增 `site_posts.body_json` 保存允許的結構化內容，原 `body` 保存從內容擷取的文字，維持搜尋與摘要。舊貼文維持純文字顯示，不會把原本輸入的 HTML 當作可執行內容。後端驗證節點、文字樣式、連結及圖片參照；閱讀端以 React 節點顯示，不執行原始 HTML。內文最多 60,000 字，文件最多 5000 節點／20 層、JSON 最多 100 萬字元，保留版本衝突檢查，避免覆蓋其他管理員更新。

文章圖片儲存在 SQLite 的 `site_post_images`，以 `site_post_image_refs` 連結文章，會隨既有 SQLite 備份保存。`/api/posts/images` 的上傳需管理員及同源請求；讀取需登入，且圖片至少被一篇已發布貼文引用，管理員可讀取草稿／下架圖片。每次讀取重新檢查發布狀態並回覆 `private, no-store`；若其他文章仍引用同一圖片且已發布，維持可讀。取消編輯或尚未引用的上傳圖片保留於資料庫、僅管理員可讀，本階段未加入圖片庫或孤立圖片自動清理；已下載／另存的內容無法追回。

驗證：`node --test tests/post-document.test.mjs tests/posts.test.mjs`，建置後 `node tests/rich-posts-http.mjs` 使用暫存 SQLite、本機伺服器與合成圖片驗證權限及圖片生命週期。另以瀏覽器測試格式選取、表格、預覽、儲存草稿及重新編輯。Chrome 自動檔案選取需要擴充套件的「Allow access to file URLs」權限；未開啟時不改動瀏覽器安全設定，圖片上傳處理仍以 HTTP 測試驗證。

Tiptap 為 MIT 授權，保留原套件授權；使用的是開源擴充，不連線 Tiptap Cloud 或使用付費功能。參見 [Tiptap 專案](https://github.com/ueberdosis/tiptap) 與 [文字樣式文件](https://tiptap.dev/docs/editor/extensions/text-styling)。

### 公開介紹首頁、最新消息與文章閱讀權限

未登入者開啟 `/` 會看到公開介紹首頁，包含平台介紹、ASLUNG／LI-COR／HOBO 功能概覽、會員申請流程及最多六篇精選／最新公開內容的標題、摘要與日期。有效登入會員開啟 `/` 仍直接進入原工作空間；保留 `/login` 與設備 QR Code 的 `/?id=...` 登入導向。`/about` 提供可隨時開啟的介紹頁，`/articles` 提供公開消息／文章列表、搜尋與每頁 20 筆分頁，`/articles/<id>` 提供可分享的全文網址。

「最新消息」與「文章專區」均可由管理員在新增／編輯畫面的「閱讀權限」選擇：

- **會員限定**：需登入才能閱讀，維持現有會員內容行為。
- **公開**：須同時為「已發布」才出現在公開首頁、列表、搜尋與全文頁。草稿與下架內容仍只有管理員可從管理模式查看。

新增 `site_posts.visibility`，既有文章與消息一律遷移為 `members`，不自動公開；新內容預設會員限定。舊 API 未傳閱讀權限時，新建維持會員限定，更新則保留原權限，並沿用版本衝突檢查。管理員可在已公開的文章閱讀畫面開啟公開頁面。公開文章包含作者名稱及所引用圖片，可能被搜尋引擎收錄；取消公開會停止後續讀取，但已下載或被外部保存的內容無法追回。

匿名讀取使用 `GET /api/posts?public=1`，可帶 `kind=news|article`、`q`、`page` 或 `id`；公開入口只查詢公開且已發布內容，不支援管理模式，不回傳編輯者 Email 或內部版本欄位。會員端原 `/api/posts` 仍須登入。公開全文及圖片每次重新確認狀態，不使用公開快取；圖片只要仍被任何已公開發布內容引用即可匿名讀取，否則回到原會員／管理員規則。檔案、設備、量測及管理 API 的授權維持原設定。

首頁、介紹頁、公開列表及 UUID 文章網址納入原有瀏覽紀錄與 30 分鐘造訪去重；不記錄搜尋參數，首頁錨點不重複計為新頁面，工作空間初始化也不額外計一次首頁瀏覽。首頁所有文章均取自明確公開內容，未設定公開內容時顯示空狀態，不使用會員文章當預設示範內容。

驗證：`node --test tests/posts.test.mjs tests/post-document.test.mjs tests/activity-security.test.mjs`；建置後 `node tests/public-home-http.mjs` 使用獨立暫存資料，驗證未登入／已登入首頁、登入及 QR 導向、舊資料不公開、公開搜尋分頁、消息及文章可見性、圖片匿名讀取、撤銷公開與空狀態。

### 首頁內容與區塊設定

系統管理員可到「網站管理 → 首頁設定」編輯區塊名稱、中英文主標、說明、卡片、資料來源、流程與按鈕文字，並保留原有六個顯示開關。七個區塊均可獨立命名及修改；「設定清單名稱」用於管理表單，「區塊標題」等欄位用於公開頁面。說明、卡片內容與步驟說明沿用 Tiptap，點「可視化編輯」可使用文字格式、清單、連結、表格及圖片；一次開啟一個欄位的編輯器，中英文內容及格式分開保存。名稱、標題、示意圖標示與按鈕文字維持純文字。內容使用經驗證的結構化 JSON，以安全的 React 節點呈現，不執行任意 HTML；既有純文字內容繼續保留。

單一區塊可重設中英文、格式與該區塊預設顯示狀態，也可全部恢復預設。重設與取消變更都先作用於草稿，按「儲存首頁設定」後才套用；重新整理公開首頁 `/` 或介紹頁 `/about` 即可看到變更。每個格式欄位最多 2,000 字與 10 張圖片，中英文首頁合計最多 30 張不同圖片。圖片沿用文章圖片上傳流程，只有儲存且對應區塊顯示時才開放匿名讀取；隱藏、移除或重設後停止公開，仍被其他公開內容使用的圖片除外。平台介紹及登入入口固定保留；編輯不會修改示意圖圖形、按鈕目的網址或文章內文。

隱藏功能介紹會一起隱藏三張介紹卡片；隱藏申請流程不會停止註冊；隱藏公開內容區不會取消內容的公開權限，公開列表與全文仍可存取。設定存於 SQLite `homepage_settings`，不需修改環境變數或重新部署；沿用資料庫備份。只有啟用中的系統管理員可讀取及修改管理設定，儲存會記錄操作紀錄並檢查版本，避免多名管理員互相覆蓋。訪客頁僅取得公開顯示開關及已啟用區塊的文字，隱藏區塊的自訂文字不傳入公開頁面的序列化資料，也不提供編輯者資訊。既有 SQLite 會自動新增 content 欄位，保留原顯示狀態及版本；舊版只儲存顯示開關的 API 呼叫不會覆蓋已編輯文字。中英文、顯示狀態與版本在同一交易儲存，避免並行編輯覆蓋。

驗證：`node --test tests/homepage-rich.test.mjs tests/homepage-content.test.mjs tests/homepage-settings.test.mjs tests/workspace-navigation.test.mjs`；`node tests/public-home-http.mjs` 另驗證管理權限、同源限制、設定驗證、舊版本拒絕、隱藏區塊及隱藏內容不出現在首頁回應。整合測試以 K 槽獨立資料庫確認儲存、公開首頁與介紹頁的自訂格式、圖片公開／停用及恢復預設結果。


### ASLUNG 歷史封存、查詢與多選清除

管理員至「校正管理 → 背景清理與校正 → 歷史資料封存至 S3」，搜尋並多選已登錄 ASLUNG ID（可全選搜尋結果），指定臺灣時間的開始日期與結束日期（含當日），選擇原始量測、校正成果或兩者。單次可選最多 500 台設備，日期最長 100 年。整段期間不受 5,000 個設備日工作的批次上限限制；建立可持續執行的月份批次後，由 worker 分批依日排入既有 calibration-worker，單一工作分頁讀取 MySQL 並串流寫入 gzip JSONL，沿用 worker 的批次大小、暫停與重試設定，不直接在網頁請求內下載整段歷史資料。來源 MySQL 必須仍保有該期間資料，封存功能無法還原來源已刪除的量測。

原始封存不需要校正係數，保留來源值、完整來源欄位及欄位別名，不套用六項規則、不查詢期間外背景樣本。校正成果沿用既有規則與係數快照；無係數的設備日會明列略過，不影響原始封存。原始檔與成果分別存於 `raw/<device>/<Taipei YYYY/MM/DD>/<job>/<sha256>.jsonl.gz`、`processed/...`，以大小與 SHA-256 驗證 S3。相同區間預設重用既有工作；來源補傳、修正或需重試抓取時勾選「重新抓取／建立新版本」。新版本不與舊版累加，查詢重疊期間選最新完成版本。

須設定 `CALIBRATION_STORAGE=s3`、`S3_BUCKET` 與 `AWS_REGION`，並啟動 calibration-worker。在 EC2 Role **額外新增** `scripts/iam-aslung-history.json`，確認其中 bucket 名稱與實際相同；保留既有校正／HOBO 讀寫與清除權限。此補充政策只新增 `raw/*` 讀寫、版本列舉與清除權限。未完成 S3 上傳時本機檔案保留並重試，工作記錄以「S3 已驗證／等待上傳／等待重試」區分，並非工作完成即代表 S3 已成功。

後續在「資料查詢」選「歷史原始封存（本機／S3）」讀取封存原始資料，或選「已完成清理與校正（六項規則）」讀取成果。兩者均可在本機檔案缺少時還原並驗證 S3 副本，供查詢與 CSV／JSON ZIP 下載；不會回查來源 MySQL 補齊缺漏期間。沿用設備／期間授權與下載權限；原始封存只回傳授權區間內資料，校正成果仍另驗證處理背景樣本權限。查詢及分頁／下載固定版本，避免重算期間混用資料。

工作記錄依資料類型切換「校正成果／原始量測封存」。清除區可獨立搜尋、多選 ASLUNG ID（未選表示全部設備），輸入開始及結束日期（含當日），先預覽實際工作期間、本機檔案與 S3 版本，再輸入 DELETE 確認；也可「預覽全部清除（本類型）」。每批最多 500 個工作，超過時請縮小範圍。篩選採期間交集，清除整個工作／每日檔，不逐筆截切資料。清除前備份 SQLite，排除處理中或上傳中工作，保留稽核、刪除標記與失敗重試；S3 所有版本與刪除標記也會清除。原始與校正工作互不刪除，來源 MySQL、校正參數、會員與電腦已下載檔案均保留。原始封存清除不更動校正自動排程；校正成果清除仍可勾選停用排程，避免重新產生。

驗證：`node --test tests/processing-history.test.mjs tests/aslung-archive-view.test.mjs`（K 槽隔離檔案、記憶體 SQLite、模擬 S3），並執行既有 processing、storage、cleanup、worker-resource 測試。未操作正式 MySQL 或 S3 資料。


設備校正參數查詢採關鍵字搜尋，不在開啟頁面時列出全部設備或參數。輸入設備 ID、通道或來源名稱（不區分大小寫、支援部分文字），按「查詢」後顯示結果；可搭配來源與版本篩選，每頁最多 200 筆。清除關鍵字後回到待查詢狀態。後端 `/api/calibration` 無關鍵字／設備條件時只回傳來源、版本與同步資訊，參數筆數為零，不載入完整設備清單。資料清除區預設收合，點選標題才展開。


### 按月依序封存與批次控制

歷史封存先建立一筆伺服器端批次與月份規劃，不在網頁請求中一次建立全部每日工作。月份依 Asia/Taipei 日曆拆分，第一個月與最後一個月保留使用者選擇的部分日期，結束日期含當日。預設每輪最多規劃 100 個設備日／資料類型單位，且當月尚未驗證的工作不超過此窗口；內部函式窗口上限仍為 5,000。每個每日工作沿用原有來源分頁、單 worker pacing 與 S3 SHA-256／大小驗證。

當月的所有原始與校正工作，必須為「S3 已驗證」或明確標示「無係數略過」，才將該月份標記完成；下一輪才排入下一個月。處理完成但尚未上傳的檔案不會讓月份前進。缺少係數僅略過校正成果，原始封存仍執行。每個每日工作排入時固定當下係數與處理配方；新版本勾選會使用整個批次固定的新版本識別，重試不會重複產生相同每日版本。提交識別碼避免網路重送建立重複批次。

介面顯示整體完成月份／總月份、已驗證加略過的工作進度、目前月份、排入量、排隊、執行中、待上傳、上傳中、失敗及原始／校正的 S3 封存列數。兩類列數分開顯示，不相加當成不重複量測數。缺少係數範例與月份清單可展開查看。已完成月份保存彙總，日後刻意清除檔案不會改寫其當時完成的稽核進度。

- 暫停：停止為此批次啟動新的工作與 S3 上傳；已在執行中的單一工作或上傳可安全收尾。按「繼續」沿用既有每日工作接續。
- 重試：處理失敗或 S3 上傳失敗時，批次停止前進並顯示原因。修正來源／權限後按「重試」，重新排入失敗工作及上傳，不重做已驗證資料。已刪除或取消的子工作需另建批次。
- 取消：須確認，停止後續月份、取消此批次專屬的等待工作，保留已產生資料與稽核；取消的批次不能續跑，可重新建立新批次。清除是獨立操作，取消不會刪除資料。

共享或重用的既有工作可能同時服務其他排程／批次，暫停或取消其中一個批次不會停止其他仍有需求的工作。升級前已排隊、未屬於月份批次的工作繼續原流程。未結束批次目前月份所引用的工作不可直接清除；需先取消批次，避免清除後自動抓回。已完成月份可依既有清除流程獨立處理。

批次、月份、每日工作參照及操作記錄保存在 SQLite `historical_batches`、`historical_batch_months`、`historical_batch_jobs`、`historical_batch_events`，隨原資料庫一起備份。關閉網頁不影響進度，worker 重啟依既有工作及上傳租約恢復，暫停／取消狀態不會因重啟解除。部署須同時更新網站與 calibration-worker；沿用既有 raw/processed S3 權限。測試使用記憶體／K 槽隔離資料庫與模擬 S3，不操作正式來源或雲端物件。
