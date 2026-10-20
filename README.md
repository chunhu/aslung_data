# ASLUNG EC2 部署版

維護人員可在新增／編輯表單填寫 `english_name`（英文完整稱呼，選填，最多 160 字）。中文介面保留原姓名，英文介面顯示已填寫的英文稱呼；未填時保留原名稱，姓名標記為不自動翻譯，名單不再顯示姓名首字圓形頭像。設備負責人、快速更新選單、維修保養與告警名單共用此顯示規則，選單儲存值仍使用原姓名，既有設備關聯及通知信箱不變。Google 試算表建議表頭為 `Cht_name | Eng_name | mail | mail_test`（不分大小寫、前後空白可忽略），`Cht_name` 作為中文姓名識別、`Eng_name` 作為英文稱呼，保留舊版 `maintainer` 表頭；若新舊表頭同時存在，以 `Cht_name`／`Eng_name` 優先。英文欄位亦相容 `english_name`、`name_en`、`英文名`、`英文名稱`、`英文稱呼` 或 `英文姓名` 欄位；沒有該欄位時保留手動設定，有該欄位但空白則清除英文稱呼。

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
- 期間查詢、資料表、JSON 預覽、CSV ZIP / JSON ZIP 下載。
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


### 告警寄信規則與會員收信偏好

- 已部署設備仍依斷線門檻顯示警示；從未上傳資料或最後回報早於一個曆年前的設備不列入告警信的內容與數量，日誌標記為「僅警示，未寄信」並記錄原因。查詢失敗仍記為狀態未知。
- 管理員可在「會員管理 → 告警收信」調整任一會員；所有已登入會員可在側欄「告警收信設定」調整自己。既有及新會員預設接收，設定保存在 SQLite `members.alert_email_enabled`，啟動時自動新增欄位。
- 寄信仍以設備目前維護人員的聯絡信箱為對象；會員開啟收信不會增加設備授權或訂閱其他設備。信箱大小寫不影響比對，已停用會員不寄送。測試信箱模式也遵守主要聯絡會員的停收設定。未註冊成會員的維護人員沿用原寄信方式。
- 此偏好僅影響設備斷線告警，不影響註冊驗證及帳號審核信。通知負責人數與最後告警寄送時間以實際成功寄送為準。


### 多來源校正管理

管理員可在「校正管理」新增多個 Google 試算表分頁網址、名稱與說明，手動同步、啟用或停用來源，查詢全部設備與歷史版本。此功能不會建立或改動設備授權，不會改寫 MySQL 原始量測資料；現有 admin/member 分級維持不變。

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

處理順序：

1. G3／GSA 分別處理：三個原始 PM 完全相等且 >50 時清除三者；各通道 <1 時清除該通道。
2. Ghost Peak 完整依 `cleanPM.py`：PM2.5 前向、反向各取五筆平均並迭代五輪，比例 <10 才保留；任一方向保留即保留，雙向都缺值時清除同組三個 PM。PM1／PM10 使用第一項清理後的數值，修正原 Python 重新帶回低值的問題。
3. temperature、rh、co2 <1 設為缺值。
4. 以清理後 PM 套用當時適用的係數；等於分段點使用第二段；負校正結果設為缺值。
5. 校正後 PM1 > PM2.5，將最終 PM1 限制為 PM2.5；兩者皆有效才判斷。
6. 使用同組原始三個 PM：PM1 >50 且 `abs(PM1-(PM1+PM2.5+PM10)/3) <= up_limit`，同組三個最終 PM 皆設為缺值。原始值不完整時留下無法判斷標記。

原始欄位保留，另附 `*_clean`、`*_calibrated`、`*_final`、`_quality`、係數記錄／版本與 `_processing_version`。`*_calibrated` 是第四項結果，`*_final` 包含第五、六項。品質摘要是各欄位旗標出現次數，同筆資料可有多個旗標，不能直接相加當作刪除列數。不刪除原始資料列。

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

在既有 Ubuntu EC2 專案中取得 `scripts/deploy_cal.sh` 後執行：

```bash
bash scripts/deploy_cal.sh
# 需要停用 Docker 建置快取時：
bash scripts/deploy_cal.sh --no-cache
```

此腳本固定部署 `codex/calibration-management`，不呼叫固定切回 main 的 `deploy.sh`。使用 fast-forward 更新；本機有未提交修改、其他未追蹤檔案或分支分歧時停止，不自動 stash／reset。可先把腳本複製到舊 checkout，唯一允許的未追蹤檔案為 scripts/deploy_cal.sh。

流程為設定系統服務開機啟動、驗證 Compose、建置網站與 worker、停止舊 worker、以直接唯讀開啟 SQLite 的方式建立升級前備份並檢查完整性、更新網站並等待健康檢查、啟動 worker 並驗證 MySQL 唯讀查詢與容器穩定性。建置與備份期間不停止既有網站。即使 Git 無更新也執行檢查與部署，預設使用 Docker 快取。失敗不會自動還原資料庫或刪除 volumes；若網站更新前已停止 worker，修正問題後重跑腳本。

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
