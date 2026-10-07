# 量測 API 規格

會員 / 授權網站已完整包含；您原有資料庫的查詢服務尚待串接。
若已有 API，可增加回應格式轉換。若沒有 API，需取得資料庫種類及欄位後建立。

## 來源設定

~~~dotenv
EC2_DATA_API_URL=https://measurements.your-domain.com/api/measurements
EC2_DATA_API_TOKEN=YOUR_SECRET_BEARER_TOKEN
~~~

URL 必須為有可信任憑證的 HTTPS；不忽略 TLS 驗證、不跟隨重新導向。
Token 只從網站後端讀取。即使 API 位於同一 EC2，也需有可驗證的 HTTPS 端點。
本包不直接連線 MySQL / PostgreSQL / MongoDB，不假設資料庫欄位。

網站向來源送出 GET，Header 為 Authorization: Bearer YOUR_SECRET_BEARER_TOKEN。

| 參數 | 規格 |
| --- | --- |
| aslung_id | 完全相符的設備識別碼 |
| start / end | 含 Z 的 ISO 8601 UTC，起訖均包含 |
| limit | 每頁最多 1,000 筆 |
| cursor | 下一頁游標，第一頁省略 |

來源應驗證 token，執行參數化查詢，以 timestamp + 唯一資料列 ID 穩定排序。
游標須避免重複 / 遺漏。網站會再次驗證設備及時間，防止來源回傳越權資料。

回應範例（非實際資料）：

~~~json
{
  "aslung_id": "ASLUNG_001",
  "data": [
    {
      "timestamp": "2026-10-01T08:00:00+08:00",
      "pn23_cm3": 125,
      "pn10_cm3": 98,
      "temperature_c": 26.5
    }
  ],
  "has_more": false,
  "next_cursor": null
}
~~~

- 外層 aslung_id 與請求一致。
- data 為陣列，最多 1,000 筆、JSON 最多 5 MB。
- 每列 timestamp 可解析且有 Z 或明確時區，落在請求期間內。
- 每列若帶 aslung_id 也要與請求一致。
- has_more 為布林值；true 時 next_cursor 為非空、不同於本頁的字串。
- 最後一頁 has_more=false、next_cursor=null。
- 無資料仍回 HTTP 200、data=[]、has_more=false。
- 錯誤回適當 HTTP 狀態，不可假成功。
- 單頁連線逾時 20 秒，完整下載最多 50 頁 / 50,000 筆；超限拒絕，不截斷。
- 除 timestamp 外可增加量測欄位；pn23_cm3、pn10_cm3 保持來源各自原值。

## 網站給會員的 JSON API

登入後，使用同源 Cookie：

~~~http
GET /api/data?aslung_id=ASLUNG_001&start=2026-10-01T00%3A00%3A00Z&end=2026-10-02T00%3A00%3A00Z
~~~

回應 aslung_id、start、end、data、has_more、next_cursor。
下一頁沿用設備及期間，加上上頁 next_cursor 作為 cursor。

加 download=1&format=json 可下載完整 JSON，format=csv 為 CSV。
JSON 下載含 count；CSV 為 UTF-8 BOM。CSV 防範文字公式，數值維持原值。

EC2_DATA_API_TOKEN 是來源 API 的憑證，不能用來略過本站會員權限。
本站 API 沒有機器帳號 API key，若要自動跨系統傳遞需另外實作。

## 後續需提供

資料庫種類、設備 ID 欄位、時間欄位與時區、量測欄位與單位、
唯一資料列 ID、既有 API 參數 / 回應範例。
不需要把正式資料庫密碼寫進文件或提供給前端。
