# ASLUNG 資料存取規格

本文件更新於 2026-10-22。完整參數、欄位及程式範例請見 [中文 API 指南](docs/ASLUNG_API_User_Guide_ZH.md) 與 [English API guide](docs/ASLUNG_API_User_Guide_EN.md)。網站功能與管理操作請見 [完整網站手冊](docs/ASLUNG_Website_User_Manual_ZH.md)。

## 資料來源與保存

ASLUNG 原始量測由後端透過 `mysql2` 直接查詢既有 MySQL `rawdata` 表；以 `uid` 對應設備、`time` 與 `id` 穩定分頁，保留來源欄位並提供量測別名。查詢使用參數化 SQL。量測來源應使用唯讀資料庫帳號，網路連線僅開放必要來源。

在 `.env` 設定 `MYSQL_HOST`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`。此版本不使用舊版文件中的 `EC2_DATA_API_URL`／`EC2_DATA_API_TOKEN` 代理架構。資料庫密碼只保存在後端，不寫入文件或前端。

SQLite 保存會員、授權、設備履歷、工作紀錄、校正索引及 HOBO 本機資料等。校正成果與 HOBO 觀測可分別設定 `CALIBRATION_STORAGE=s3`、`HOBO_STORAGE=s3`，共用 `AWS_REGION`／`S3_BUCKET` 與 EC2 Role；SQLite 備份不等於 MySQL、S3 或本機成果目錄的完整備份。

## 網站提供的 API

`GET /api/data` 使用登入 Cookie 或「資料串接」建立的 Bearer token；兩者均執行相同設備、期間與角色授權。停用帳號或撤銷 token 後不能繼續存取。一般帳號單次最多查詢 31 天；管理員不受此日期上限限制。

| 參數 | 用途 |
| --- | --- |
| `aslung_id` | 指定設備 |
| `start` / `end` | ISO 8601，包含時區；原始量測查詢包含起訖 |
| `segment_id` | 指定設備追蹤區段，依實際授權判斷 |
| `calibration` | `raw`（預設）、`both`（即時係數）、`processed`（背景成果） |
| `cursor` | 上頁回傳的游標；沿用相同設備、期間與模式 |
| `calibration_snapshot` | 固定校正版本；背景成果分頁須沿用回應中的版本 |
| `download` / `format` | `download=1` 配合 `csv`、`json`、`csvzip`、`jsonzip`；皆回傳 ZIP |

一般分頁回傳 `data`、`has_more`、`next_cursor` 等資訊，單頁最多 1,000 筆。背景成果未涵蓋所選區間會明確回報錯誤；不以原始資料冒充校正結果。下載 ZIP 的內容依模式包含資料檔及說明，應先解壓縮再解析 CSV／JSON，不能直接把 HTTP 回應當作純文字 CSV。請依設備及合理期間分批下載，勿假設固定 50,000 筆上限。

CSV 包含 UTF-8 BOM，並保留來源欄位、校正中間值、品質標記及版本資訊（依模式與來源決定）。電池為來源 `ch7` 值，不可未經規格確認就視為百分比。

## HOBO

HOBO 來源使用伺服器端 `LICOR_API_TOKEN`，與本站會員 token 不同。`GET /api/hobo?action=query` 及 `action=csv` 限管理員，支援 `serial`、`start`、`end`、`measurement`、`sensor`、`q`；資料查詢另支援 `after`。HOBO CSV 是直接 CSV，與 ASLUNG ZIP 格式不同。同步工作按臺灣月份切割、按日請求，共用請求間隔與重試等待；詳見完整網站手冊。

## 錯誤與安全

401 表示尚未驗證或 token 無效，403 表示角色／資料授權不足，409 常見於背景成果尚未備齊或版本衝突。錯誤內容應作為排查線索，不將失敗回應視為成功資料。使用 HTTPS；不要將來源 token、會員 token 或資料庫密碼放在 URL、Git 或公開文件。
