# ASLUNG Data Query and Download API User Guide

This system provides a standard RESTful API for researchers, developers, and external applications (such as Python analytics scripts, data schedulers, and dashboards) to securely access authorized ASLUNG device monitoring data.

---

## 1. Authentication

The API uses **Bearer Token** authentication. Every HTTP request must include your dedicated token in the Request Header.

### 1.1 How to Obtain an API Token
1. Sign in to the ASLUNG Data Management Platform.
2. In the left navigation menu, click **"System Connection Status"** (or Connection).
3. In the **"My API Access Tokens"** section, click **"Generate Token"**.
4. Copy the generated token string (e.g., `aslung_9f3a8b2c4d...`).

### 1.2 HTTP Request Header Configuration
```http
Authorization: Bearer aslung_your_token_here
```

> **Note**: When called directly within an authenticated browser session, the system automatically authenticates via the HttpOnly Session Cookie (`aslung_session`), and the `Authorization` header can be omitted.

---

## 2. API Endpoint & HTTP Method

- **Server URL**: `https://api.lunglab.rcec.sinica.edu.tw/`
- **Endpoint URL**: `https://api.lunglab.rcec.sinica.edu.tw/api/data` (Local development: `http://localhost:3000/api/data`)
- **HTTP Method**: `GET`
- **Data Protection**: Enforces server-side permission verification. Users can only query devices and time ranges explicitly granted by administrators.

---

## 3. Query Parameters

| Parameter | Type | Required | Description | Example |
| :--- | :--- | :---: | :--- | :--- |
| `aslung_id` | `string` | **Yes** | Device identifier to query. | `AL-0001` |
| `start` | `string` | **Yes** | Query start timestamp (**ISO 8601** format with timezone). | `2026-10-01T00:00:00+08:00` |
| `end` | `string` | **Yes** | Query end timestamp (**ISO 8601** format with timezone). | `2026-10-07T23:59:59+08:00` |
| `cursor` | `string` | No | Pagination cursor. When records exceed page limit, supply the `next_cursor` from the previous response. | `eyJ0aW1lIjoi...` |
| `download` | `string` | No | When set to `1`, enables full download mode. The server automatically merges all pages within the interval. | `1` |
| `format` | `string` | No | Export format: `json` or `csv` (default is `json`, requires `download=1`). | `csv` |

> **Important Constraints**:
> 1. The query duration (`end - start`) **must not exceed 31 days**. Requests exceeding 31 days will return HTTP 400.
> 2. `start` must not be later than `end`.
> 3. If you need data spanning more than 31 days, please split the requests into monthly batches.

---

## 4. Sensor Data Field Specifications

Each measurement record returned by the API contains the following fields:

| Field Name | Type | Unit / Description |
| :--- | :--- | :--- |
| `timestamp` | `string` | Measurement timestamp (ISO 8601 UTC format, e.g. `2026-10-01T08:00:15.000Z`) |
| `aslung_id` | `string` | ASLUNG device identifier |
| `PM1_G3` | `number` | PM1.0 mass concentration (Plantower G3 sensor, $\mu g/m^3$) |
| `PM2.5_G3` | `number` | PM2.5 mass concentration (Plantower G3 sensor, $\mu g/m^3$) |
| `PM10_G3` | `number` | PM10 mass concentration (Plantower G3 sensor, $\mu g/m^3$) |
| `temperature` | `number` | Ambient temperature ($^\circ\text{C}$) |
| `rh` | `number` | Relative humidity ($\%$) |
| `co2` | `number` | Carbon dioxide concentration ($\text{ppm}$) |
| `battery` | `number` | Device battery percentage ($\%$) |
| `acc_x` | `number` | X-axis accelerometer reading |
| `acc_y` | `number` | Y-axis accelerometer reading |
| `acc_z` | `number` | Z-axis accelerometer reading |
| `gps` | `string` | GPS coordinates |
| `gps_speed` | `number` | Movement speed ($\text{km/h}$) |
| `gps_direction` | `number` | Heading direction (degrees) |
| `gps_height` | `number` | Altitude (meters) |
| `air_pressure` | `number` | Atmospheric pressure ($\text{hPa}$) |
| `noise1` | `number` | Noise sensor channel 1 ($\text{dB}$) |
| `noise2` | `number` | Noise sensor channel 2 ($\text{dB}$) |
| `noise3` | `number` | Noise sensor channel 3 ($\text{dB}$) |
| `PM1_GSA` | `number` | PM1.0 mass concentration (GSA sensor, $\mu g/m^3$) |
| `PM2.5_GSA` | `number` | PM2.5 mass concentration (GSA sensor, $\mu g/m^3$) |
| `PM10_GSA` | `number` | PM10 mass concentration (GSA sensor, $\mu g/m^3$) |
| `Num_0.3_GSA` | `number` | Particle count $\ge 0.3\,\mu m$ |
| `Num_0.5_GSA` | `number` | Particle count $\ge 0.5\,\mu m$ |
| `Num_1.0_GSA` | `number` | Particle count $\ge 1.0\,\mu m$ |
| `Num_2.5_GSA` | `number` | Particle count $\ge 2.5\,\mu m$ |
| `Num_5.0_GSA` | `number` | Particle count $\ge 5.0\,\mu m$ |
| `Num_10_GSA` | `number` | Particle count $\ge 10\,\mu m$ |

---

## 5. Response Examples

### 5.1 Paginated Query Mode (Default)
```http
GET /api/data?aslung_id=AL-0001&start=2026-10-01T00:00:00%2B08:00&end=2026-10-02T00:00:00%2B08:00
```

**JSON Response Example**:
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

> **Pagination note**: Each page returns up to 1,000 records. If `has_more` is `true`, pass `next_cursor` as the `cursor` query parameter in the subsequent request to retrieve the next page.

---

### 5.2 Full Download Mode (CSV File)
```http
GET /api/data?aslung_id=AL-0001&start=2026-10-01T00:00:00%2B08:00&end=2026-10-07T23:59:59%2B08:00&download=1&format=csv
```
- Directly streams and downloads the CSV file (`aslung_AL-0001_export.csv`, UTF-8 encoded).

---

## 6. Code Examples

### 6.1 cURL Commands

#### (1) Query Paginated JSON Data
```bash
curl -X GET "https://api.lunglab.rcec.sinica.edu.tw/api/data?aslung_id=AL-0001&start=2026-10-01T00:00:00%2B08:00&end=2026-10-03T00:00:00%2B08:00" \
     -H "Authorization: Bearer aslung_your_token_here"
```

#### (2) Download Complete CSV File Directly
```bash
curl -X GET "https://api.lunglab.rcec.sinica.edu.tw/api/data?aslung_id=AL-0001&start=2026-10-01T00:00:00%2B08:00&end=2026-10-07T23:59:59%2B08:00&download=1&format=csv" \
     -H "Authorization: Bearer aslung_your_token_here" \
     -o output.csv
```

---

### 6.2 Python Script (Using `requests` and `pandas`)

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

# Method 1: Directly stream into pandas DataFrame via download=1&format=csv
csv_url = f"{API_URL}?aslung_id={DEVICE_ID}&start={START_TIME}&end={END_TIME}&download=1&format=csv"
response = requests.get(csv_url, headers=headers)

if response.status_code == 200:
    df = pd.read_csv(io.StringIO(response.text))
    print(f"Successfully downloaded {len(df)} records!")
    print(df[["timestamp", "PM2.5_G3", "temperature", "rh", "co2"]].head())
else:
    print(f"Request failed ({response.status_code}):", response.text)
```

---

### 6.3 JavaScript / Node.js Example

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
    throw new Error(err.error || "Query failed");
  }

  const result = await res.json();
  console.log(`Retrieved ${result.data.length} records:`, result.data[0]);
}

fetchSensorData();
```

---

## 7. HTTP Status Codes & Error Handling

| Status Code | Error Reason | Resolution |
| :--- | :--- | :--- |
| `400 Bad Request` | Missing required parameters, invalid date format, start time is after end time, or **interval exceeds 31 days**. | Verify parameter names, ISO 8601 formatting, and ensure the date range is $\le$ 31 days. |
| `401 Unauthorized` | Missing Authorization token or invalid/revoked token. | Verify that the `Authorization: Bearer <Token>` header is properly configured. |
| `403 Forbidden` | The account is **not authorized for this device**, or the queried interval is outside the approved access window. | Submit an access request via "Request Device Access" in the workspace, or contact the administrator. |
| `404 Not Found` | Device ID (`aslung_id`) does not exist in the database. | Confirm the device ID spelling and status. |
| `502 Bad Gateway` | EC2 MySQL database connection failed or query error. | Retry later or contact the system administrator to verify EC2 connection status. |
