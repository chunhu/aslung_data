# 檔案專區：上傳與外部連結 / File resources

## 管理員操作

在側邊欄「檔案專區」可選擇「上傳檔案」或「新增外部連結」。外部連結填寫檔案名稱、完整 http/https 網址、選填說明並勾選授權會員，再按「新增連結並指派授權」。未指派會員時，只有 admin 可存取；之後可從「設定授權」調整。

清單以「外部連結」標示，大小欄顯示「外部檔案」，因為本站不會下載外部內容或查詢大小。已授權會員點「開啟下載連結」後，本站重新驗證登入及檔案授權，再在新分頁前往外部網站。開啟次數代表連結開啟，不代表外部檔案已成功下載。

外部平台仍決定檔案能否下載、是否要求登入及連結有效期限；請另行設定該平台的分享權限。本站授權無法阻止已知外部網址者繞過本站直接前往，若需保護敏感檔案，外部平台也必須限制收件者。網址僅接受 http/https，不接受腳本、檔案協定或內嵌帳密。帶有效期限的簽署網址可保存，但到期後需重新提供有效連結。

刪除外部連結只移除本站資料與授權，不刪除外部檔案。SQLite 備份保存連結與授權，不包含外部檔案內容。舊有直接上傳及下載流程維持使用。

## Technical notes

The existing `files` table gains a nullable `external_url` column. Existing uploads retain a null URL and their local storage paths. External resources store metadata with an empty storage path; no file body is fetched or copied. Migration is idempotent and preserves existing files and grants.

Admin creates a link with `POST /api/files` using `action: "fileLink"`, `name`, `url`, optional `description`, and an `emails` array of existing members. Metadata and grants are committed atomically. `GET /api/files?id=<ID>&download=1` checks identity and the existing file grant before returning a private, non-cacheable HTTP 303 redirect. Browser access is separate from the external provider's access controls and expiry. Ordinary uploads continue to return file bodies.

Members see only their granted resources. Deleting a link removes its local record and grants, never the external provider's file. Backups contain URLs and access metadata, not external file bodies. Open counts indicate link navigation, not confirmed download completion.
