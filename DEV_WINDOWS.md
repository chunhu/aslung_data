# Windows 本機開發

## 安裝與啟動

安裝 Node.js 24.13 以上及 Corepack，然後在專案根目錄執行。pnpm 版本由 package.json 鎖定。

```powershell
corepack pnpm install --frozen-lockfile
Copy-Item .env.example .env
```

編輯 .env，將本機設定改為：

```dotenv
APP_ORIGIN=http://localhost:3000
DATABASE_PATH=./data/aslung.sqlite
BACKUP_PATH=./backups
MYSQL_HOST=127.0.0.1
MYSQL_USER=aslung_dev
MYSQL_PASSWORD=replace-with-your-development-password
MYSQL_DATABASE=aslung_dev
NEXT_TELEMETRY_DISABLED=1
```

目前程式透過 MySQL 查詢量測資料；原有 README 的 EC2_DATA_API 設定已不反映目前實作。請填入開發用 MySQL 連線設定。未連接 MySQL 時，可先開發登入、會員及授權介面。

首次使用時，先在終端互動建立管理員，再啟動網站：

```powershell
corepack pnpm admin:create
corepack pnpm dev --hostname 127.0.0.1
```

開啟 http://localhost:3000 。停止伺服器按 Ctrl+C。

SQLite 保存於 data/aslung.sqlite，備份保存於 backups/。這些資料、.env 與 .tools/ 不納入 Git。

## 本機附加工具

這次工作站設定另有未納入 Git 的 .tools/，包含 Node.js 24.21.0 與 pnpm 啟動腳本。在此工作站可將上述 corepack pnpm 替換為：

```powershell
.\.tools\pnpm.ps1 dev --hostname 127.0.0.1
```

重新 clone 的環境請使用前述標準安裝步驟。

## 驗證結果（2026-10-14）

- pnpm install --frozen-lockfile 成功，鎖定檔未修改。
- pnpm build 成功，包含 TypeScript 檢查。
- 開發伺服器啟動成功，/api/health 與 /login 都回傳 HTTP 200。
- 已修正 SQLite 初始化時重複新增 nickname 的問題；兩項資料庫初始化／升級回歸測試通過。
- 已將根版型的翻譯相容腳本改為 next/script beforeInteractive，登入頁不再出現 React 原生 script 警告。
- 側邊選單等待會員權限載入後才顯示，避免重新整理時短暫顯示所有管理功能。
- pnpm test：3 項通過、2 項失敗。既有 auth.test.mjs 用 6 個值寫入目前有 9 欄的 members；data.test.mjs 仍假設舊 HTTPS API，無法載入目前 MySQL 版本的模組。
- pnpm test:integration：同樣在舊的 members 測試資料寫入處失敗，尚未進入 HTTP 流程。

驗證指令：

```powershell
corepack pnpm test
corepack pnpm build
corepack pnpm test:integration
```
