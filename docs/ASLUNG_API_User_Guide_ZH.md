# ASLUNG 資料查詢與下載 API 使用說明

修訂日期：2026 年 10 月 22 日。本文件取代舊版 API 說明；完整網站操作請另見 ASLUNG 網站完整使用與管理說明。本 API 不會因持有 Token 而放寬帳號角色、設備與期間授權。

## 一 身分認證

登入網站的「資料串接」，在「我的 API 存取權杖」產生 Token。外部程式以 Authorization: Bearer YOUR_TOKEN 認證；已登入的同源瀏覽器可使用 Session Cookie。撤銷 Token 後使用它的程式將無法存取。不要把真實 Token 寫入文件或 Git。

```http
Authorization: Bearer YOUR_TOKEN
```

正式 Base URL 應使用機構已完成 DNS 與 HTTPS 的網站網址，例如 `https://api.lunglab.rcec.sinica.edu.tw`；此例不保證網域當下已完成設定。本機例為 `http://127.0.0.1:3105`，依實際開發埠調整。

## 二 端點與權限

ASLUNG 量測使用 GET /api/data。伺服器檢查角色、設備、追蹤區段及資料期間。viewer 可依授權查詢，但禁止量測下載；其餘非 admin 角色仍需另有資料授權。沒有 segment_id 時，查詢整段期間必須符合授權；有 segment_id 時依該追蹤區段可用期間交集查詢。

一般非 admin 的查詢及下載最多 31 天；admin 不受此日期上限，但仍可能遇到匯出、處理版本及系統資源限制。背景處理建立工作本身每次最多 31 天，與 admin 查詢是否免日期限制不同。

## 三 請求參數

| 參數 | 必填 | 說明 |
| --- | --- | --- |
| aslung_id | 是 | 已建檔的 ASLUNG ID |
| start | 是 | 開始時間，建議含時區 ISO 8601 |
| end | 是 | 結束時間，不早於開始，起訖均包含 |
| segment_id | 否 | 指定授權追蹤區段 |
| cursor | 否 | 上一頁的 next_cursor，不自行解析或修改 |
| calibration | 否 | raw 預設原始值；both 即時計算係數；processed 完整背景成果 |
| calibration_snapshot | 否 | 沿用 both 或 processed 回傳的版本快照 |
| download | 否 | 1 表示完整下載，否則分頁 JSON |
| format | 否 | 下載選 csv、json，亦接受 csvzip、jsonzip；均為 ZIP |

日期範例為 2026-10-01T00:00:00+08:00 或 2026-09-30T16:00:00Z。URL 中的加號須編碼成 %2B，建議用 requests 的 params 或 URLSearchParams，避免手工拼接。雖然伺服器相容部分臺灣日期輸入，外部程式仍應明確提供時區。

raw 不套係數。both 保留原始欄位，增加校正值、狀態及係數版本；分段點相等使用第二段，負值保留。processed 讀取已完成六項規則結果，非現場重新計算；期間未完整處理時回覆 409，不用原始值補缺。它還檢查 Ghost Peak 實際前後背景樣本授權。

## 四 欄位與品質

| 欄位 | 對應或意義 |
| --- | --- |
| timestamp | UTC ISO 8601 量測時間，原始 time 的標準化表示 |
| aslung_id / uid | 設備識別，原始欄位與易讀別名依模式存在 |
| PM1_G3、PM2.5_G3、PM10_G3 | ch1、ch2、ch3 的原始 G3 PM |
| temperature、rh、co2 | ch4、ch5、ch6 的原始溫度、濕度、CO₂ |
| battery | ch7 原值，單位依設備定義，不保證百分比 |
| acc_x、acc_y、acc_z | ch8、ch9、ch10 原值 |
| gps、gps_speed、gps_direction、gps_height | ch11 至 ch14 原值，編碼與單位依設備定義 |
| air_pressure、noise1、noise2、noise3 | ch21 至 ch24 原值 |
| PM1_GSA、PM2.5_GSA、PM10_GSA | ch29 至 ch31，與 G3 分開處理 |
| Num_0.3_GSA 至 Num_10_GSA | ch32 至 ch37 粒徑數量原值 |
| ch* 與其他來源欄位 | 新版保留 rawdata 完整欄位，不只上述易讀名稱 |
| *_clean、*_calibrated、*_final | 清理、套係數與最終六項規則值，依模式存在 |
| *_calibration_status 與版本欄 | 校正狀態、記錄與版本；保留供追溯 |
| _quality、_background_status | 完整規則品質旗標與背景樣本資訊 |

來源數值可能是數字或數字字串；新版計算解析有限十進位數值，但原欄型別保留。空白或 null 不是 0。NO_FACTOR 代表沒有適用係數；INVALID_RAW 代表無效原值；CONFLICT 或 FACTOR_CONFLICT 代表係數衝突。品質摘要可能對同一筆累計多個旗標，並非刪除列數。詳細清理規則與全欄位說明見網站的「欄位資料說明文件」。

## 五 回應與下載

分頁 JSON 通常每頁最多 1,000 筆，含 data、has_more、next_cursor、calibration、calibration_snapshot 與授權期間等欄位；processed 的額外工作與快照資訊依結果模式回傳。以 has_more 與 next_cursor 決定下一頁，不因 data 為空就自行猜測有無整段歷史。

```json
{
  "aslung_id": "AL-0001",
  "data": [{"timestamp": "2026-10-01T00:00:00.000Z", "PM1_G3": 12}],
  "has_more": false,
  "next_cursor": null,
  "calibration": "raw",
  "calibration_snapshot": ""
}
```

download=1 時，csv/csvzip 回傳包含 CSV 的 ZIP；json/jsonzip 回傳包含 JSON 的 ZIP，檔名以設備與臺灣日期命名。伺服器串流合併分頁，設有分頁迭代等保護，超限回錯誤而非默默截斷；舊文件的固定 50,000 筆描述已不適用。請讀取實際 Content-Type 及下載檔案，不以副檔名猜測內容。

## 六 程式範例

以下使用示意設備與環境變數，不含真實密鑰。需由您提供有效 Base URL、Token 與資料授權。

```python
import os
import io
import zipfile
import requests

base = os.environ['ASLUNG_BASE_URL'].rstrip('/')
headers = {'Authorization': 'Bearer ' + os.environ['ASLUNG_TOKEN']}
params = {
    'aslung_id': 'AL-0001',
    'start': '2026-10-01T00:00:00+08:00',
    'end': '2026-10-02T00:00:00+08:00',
    'calibration': 'both',
}
while True:
    response = requests.get(base + '/api/data', headers=headers,
                            params=params, timeout=120)
    response.raise_for_status()
    page = response.json()
    for row in page['data']:
        print(row['timestamp'])
    if 'calibration_snapshot' in page:
        params['calibration_snapshot'] = page['calibration_snapshot']
    if not page.get('has_more'):
        break
    cursor = page.get('next_cursor')
    if not cursor or cursor == params.get('cursor'):
        raise RuntimeError('Pagination did not advance')
    params['cursor'] = cursor

params.pop('cursor', None)
params.update(download='1', format='csv')
response = requests.get(base + '/api/data', headers=headers,
                        params=params, timeout=300)
response.raise_for_status()
with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
    csv_name = next(n for n in archive.namelist() if n.endswith('.csv'))
    csv_text = archive.read(csv_name).decode('utf-8-sig')
    print(csv_text.splitlines()[0])
```

批次網站下載另外附中英文 download_manifest.txt；匯出成功只代表檔案產生，不代表每個通道都通過品質條件。請保留清單及版本資訊。

## 七 錯誤處理

| HTTP | 處理方式 |
| --- | --- |
| 400 | 修正日期、模式、參數或超過一般會員 31 天範圍 |
| 401 | 重新登入，或檢查是否使用有效 ASLUNG Token |
| 403 | 檢查設備、區段、期間、viewer 限制及背景樣本授權 |
| 404 | 核對設備、工作或檔案是否存在 |
| 409 | 等待完整處理成果，或重新取得已變更的快照／資料 |
| 413 | 縮短匯出範圍或減少處理版本 |
| 502 或 503 | 查來源、S3、服務設定與 worker，不要將錯誤當零筆資料 |

避免無限重試；保留 HTTP、經去密的錯誤訊息、設備與期間交由管理員排查。health=ok 不驗證所有外部服務。

## 八 HOBO 網站查詢 API

HOBO 與 ASLUNG 原始量測是不同資料集。目前僅 admin 可呼叫 GET /api/hobo；它查已匯入的本機／S3 資料，不直接把 LI-COR Token 交給瀏覽器。

| 參數 | 說明 |
| --- | --- |
| action | query 分頁，csv 直接下載 CSV；省略為管理狀態 |
| serial | Logger Serial Number，必填於 query/csv |
| start、end | 含時區 ISO 8601，查詢起訖包含 |
| measurement | 選填，量測項目包含比對，不分大小寫 |
| sensor | 選填，感測器序號包含比對，不分大小寫 |
| q | 選填，原始欄位文字關鍵字；各搜尋欄最多 160 字 |
| after | query 下一頁使用回傳的 next 數字，初頁 0 |

query 回傳 rows 及 next，每頁最多 200 筆；next 為 null 表示完成。csv 套用相同篩選、下載全部符合資料，與 ASLUNG 的 ZIP 不同。欄位為 logger_sn、sensor_sn、timestamp、data_type、data_type_id、value、unit、sensor_measurement_type。時間是 UTC、單位保留原值。POST 同步、取消、批量操作與永久清除僅供管理端，還需要符合 APP_ORIGIN 的 Origin；不要在研究下載腳本中混入管理刪除操作。
