# ASLUNG 數據查詢與下載 API 使用說明書

本系統提供標準 RESTful API，供研究人員、開發者與外部應用程式（如 Python 分析腳本、資料排程器、儀表板等）安全存取經授權的 ASLUNG 設備監測數據。

---

## 一、 身分認證方式（Authentication）

API 採用 **Bearer Token** 認證機制，每次發送 HTTP 請求時，均需於 Request Header 帶入您的專屬權杖。

### 1. 如何取得 API Token？
1. 登入 ASLUNG 資料管理平台。
2. 點擊側邊欄的 **「系統連線狀態」**。
3. 找到 **「我的 API 存取權杖」** 區塊，點擊 **「產生權杖」** 按鈕。
4. 複製產生的權杖字串（格式例如：`aslung_9f3a8b2c4d...`）。

### 2. HTTP 請求標頭（Header）設定
```http
Authorization: Bearer aslung_your_token_here
```

> **提示**：若在已登入的瀏覽器環境中直接呼叫，系統會自動使用使用者的 Session Cookie 認證，可省略 `Authorization` 標頭。

---

## 二、 API 端點與請求方法

- **伺服器網址**：`https://api.lunglab.rcec.sinica.edu.tw/`
- **端點 URL**：`https://api.lunglab.rcec.sinica.edu.tw/api/data`（本機開發測試為 `http://localhost:3000/api/data`）
- **請求方法**：`GET`
- **資料保護**：強制套用伺服器端權限驗證，僅能查詢管理員指派給該帳號的「設備授權名單」與「可存取有效期間」。

---

## 三、 請求參數（Query Parameters）

| 參數名稱 | 類型 | 必填 | 說明 | 範例 |
| :--- | :--- | :---: | :--- | :--- |
| `aslung_id` | `string` | **是** | 要查詢的設備編號識別碼。 | `AL-0001` |
| `start` | `string` | **是** | 查詢起始時間（需為含時區的 **ISO 8601** 格式）。 | `2026-10-01T00:00:00+08:00` |
| `end` | `string` | **是** | 查詢結束時間（需為含時區的 **ISO 8601** 格式）。 | `2026-10-07T23:59:59+08:00` |
| `cursor` | `string` | 否 | 分頁游標。當資料超過單頁限制時，帶入上一頁回傳的 `next_cursor`。 | `eyJ0aW1lIjoi...` |
| `download` | `string` | 否 | 設為 `1` 時啟動完整下載模式，伺服器會自動合併期間內全部資料。 | `1` |
| `format` | `string` | 否 | 下載格式，可選 `json` 或 `csv`（預設為 `json`，需搭配 `download=1`）。 | `csv` |

> **重要限制**：
> 1. 單次查詢的日期範圍（`end - start`）**不可超過 31 天**；超過將回傳 HTTP 400 錯誤。
> 2. `start` 時間不得晚於 `end` 時間。
> 3. 若需獲取超過 31 天的歷史數據，請分段依月批次請求。

---

## 四、 感測器數值欄位定義對照表

API 回傳之每一筆量測紀錄對應的欄位定義如下：

| 欄位名稱 | 數據型態 | 單位 / 說明 |
| :--- | :--- | :--- |
| `timestamp` | `string` | 量測時間戳記（ISO 8601 UTC 格式，例如 `2026-10-01T08:00:15.000Z`） |
| `aslung_id` | `string` | ASLUNG 設備識別碼 |
| `PM1_G3` | `number` | PM1.0 顆粒物濃度（Plantower G3 感測器，$\mu g/m^3$） |
| `PM2.5_G3` | `number` | PM2.5 顆粒物濃度（Plantower G3 感測器，$\mu g/m^3$） |
| `PM10_G3` | `number` | PM10 顆粒物濃度（Plantower G3 感測器，$\mu g/m^3$） |
| `temperature` | `number` | 環境溫度（$^\circ\text{C}$） |
| `rh` | `number` | 相對濕度（$\%$） |
| `co2` | `number` | 二氧化碳濃度（$\text{ppm}$） |
| `battery` | `number` | 設備電池剩餘電量百分比（$\%$） |
| `acc_x` | `number` | X 軸加速度計讀值 |
| `acc_y` | `number` | Y 軸加速度計讀值 |
| `acc_z` | `number` | Z 軸加速度計讀值 |
| `gps` | `string` | GPS 經緯度座標資訊 |
| `gps_speed` | `number` | 移動速度（$\text{km/h}$） |
| `gps_direction` | `number` | 前進航向角（度） |
| `gps_height` | `number` | GPS 海拔高度（公尺） |
| `air_pressure` | `number` | 大氣壓力值（$\text{hPa}$） |
| `noise1` | `number` | 噪音感測器 1 讀值（$\text{dB}$） |
| `noise2` | `number` | 噪音感測器 2 讀值（$\text{dB}$） |
| `noise3` | `number` | 噪音感測器 3 讀值（$\text{dB}$） |
| `PM1_GSA` | `number` | PM1.0 顆粒物濃度（GSA 感測器，$\mu g/m^3$） |
| `PM2.5_GSA` | `number` | PM2.5 顆粒物濃度（GSA 感測器，$\mu g/m^3$） |
| `PM10_GSA` | `number` | PM10 顆粒物濃度（GSA 感測器，$\mu g/m^3$） |
| `Num_0.3_GSA` | `number` | 粒徑 $\ge 0.3\,\mu m$ 顆粒計數 |
| `Num_0.5_GSA` | `number` | 粒徑 $\ge 0.5\,\mu m$ 顆粒計數 |
| `Num_1.0_GSA` | `number` | 粒徑 $\ge 1.0\,\mu m$ 顆粒計數 |
| `Num_2.5_GSA` | `number` | 粒徑 $\ge 2.5\,\mu m$ 顆粒計數 |
| `Num_5.0_GSA` | `number` | 粒徑 $\ge 5.0\,\mu m$ 顆粒計數 |
| `Num_10_GSA` | `number` | 粒徑 $\ge 10\,\mu m$ 顆粒計數 |

---

## 五、 回應格式範例

### 1. 分頁查詢模式（預設）
```http
GET /api/data?aslung_id=AL-0001&start=2026-10-01T00:00:00%2B08:00&end=2026-10-02T00:00:00%2B08:00
```

**JSON 回應範例**：
```json
{
  "aslung_id": "AL-0001",
  "start": "2026-09-30T16:00:00.000Z",
  "end": "2026-10-01T16:00:00.000Z",
  "data": [
    {
      "id": 105820,
      "aslung_id": "AL-0001",
      "timestamp": "2026-09-30T16:00:15.000Z",
      "PM1_G3": 11.2,
      "PM2.5_G3": 15.6,
      "PM10_G3": 22.4,
      "temperature": 27.5,
      "rh": 68.2,
      "co2": 510,
      "battery": 98,
      "PM1_GSA": 10.8,
      "PM2.5_GSA": 14.9,
      "PM10_GSA": 21.8
    }
  ],
  "has_more": true,
  "next_cursor": "eyJ0aW1lIjoiMjAyNi0wOS0zMCAxNjowMDoxNSIsImlkIjoxMDU4MjB9"
}
```

> **分頁說明**：單頁最多回傳 1,000 筆。若 `has_more` 為 `true`，可將 `next_cursor` 數值作為下一個請求的 `cursor` 參數以取得下一頁數據。

---

### 2. 完整下載模式（CSV 檔案）
```http
GET /api/data?aslung_id=AL-0001&start=2026-10-01T00:00:00%2B08:00&end=2026-10-07T23:59:59%2B08:00&download=1&format=csv
```
- 直接串流下載 CSV 檔案（例如 `aslung_AL-0001_export.csv`，UTF-8 編碼）。

---

## 六、 程式碼呼叫範例

### 1. cURL 指令

#### (1) 查詢分頁 JSON 數據
```bash
curl -X GET "https://api.lunglab.rcec.sinica.edu.tw/api/data?aslung_id=AL-0001&start=2026-10-01T00:00:00%2B08:00&end=2026-10-03T00:00:00%2B08:00" \
     -H "Authorization: Bearer aslung_your_token_here"
```

#### (2) 直接下載完整 CSV 檔案
```bash
curl -X GET "https://api.lunglab.rcec.sinica.edu.tw/api/data?aslung_id=AL-0001&start=2026-10-01T00:00:00%2B08:00&end=2026-10-07T23:59:59%2B08:00&download=1&format=csv" \
     -H "Authorization: Bearer aslung_your_token_here" \
     -o output.csv
```

---

### 2. Python 腳本（使用 `requests` 與 `pandas`）

```python
import io
import requests
import pandas as pd

API_URL = "https://api.lunglab.rcec.sinica.edu.tw/api/data"
API_TOKEN = "aslung_your_token_here"
DEVICE_ID = "AL-0001"
START_TIME = "2026-10-01T00:00:00+08:00"
END_TIME = "2026-10-05T23:59:59+08:00"

headers = {
    "Authorization": f"Bearer {API_TOKEN}"
}

# 方法一：利用 download=1&format=csv 直接載入 Pandas DataFrame
csv_url = f"{API_URL}?aslung_id={DEVICE_ID}&start={START_TIME}&end={END_TIME}&download=1&format=csv"
response = requests.get(csv_url, headers=headers)

if response.status_code == 200:
    df = pd.read_csv(io.StringIO(response.text))
    print(f"成功下載 {len(df)} 筆資料！")
    print(df[["timestamp", "PM2.5_G3", "temperature", "rh", "co2"]].head())
else:
    print(f"查詢失敗 ({response.status_code}):", response.text)
```

---

### 3. JavaScript / Node.js 範例

```javascript
const API_URL = "https://api.lunglab.rcec.sinica.edu.tw/api/data";
const API_TOKEN = "aslung_your_token_here";

async function fetchSensorData() {
  const params = new URLSearchParams({
    aslung_id: "AL-0001",
    start: "2026-10-01T00:00:00+08:00",
    end: "2026-10-03T00:00:00+08:00"
  });

  const res = await fetch(`${API_URL}?${params.toString()}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${API_TOKEN}`,
      "Accept": "application/json"
    }
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "查詢失敗");
  }

  const result = await res.json();
  console.log(`取得 ${result.data.length} 筆資料`, result.data[0]);
}

fetchSensorData();
```

---

## 七、 常見錯誤狀態碼（HTTP Status Codes）

| 狀態碼 | 錯誤原因 | 解決方式 |
| :--- | :--- | :--- |
| `400 Bad Request` | 缺少必要欄位、時間格式不合標準、開始時間晚於結束時間，或**查詢區間超過 31 天**。 | 檢查參數名稱與 ISO 8601 時間格式，縮短日期區間至 31 天以內。 |
| `401 Unauthorized` | 未提供 Token，或 Token 已被刪除 / 逾期。 | 檢查 Request Header 是否包含正確的 `Authorization: Bearer <Token>`。 |
| `403 Forbidden` | 該會員**未被授權存取此設備**，或查詢時間超出了管理員核准的有效授權區間。 | 透過工作空間右上方「申請設備授權」，或聯絡管理員開通該設備與時間權限。 |
| `404 Not Found` | 系統資料庫中查無此 `aslung_id`。 | 確認設備 ID 是否正確輸入。 |
| `502 Bad Gateway` | EC2 MySQL 資料庫連線中斷或伺服器異常。 | 請稍後重試或通報系統管理員檢查 EC2 連線狀態。 |
