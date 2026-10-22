# ASLUNG Data Query and Download API Guide

Revised 22 October 2026. This guide replaces the earlier API instructions. See the Website User and Administration Manual for complete workflows. A token does not expand its owner's role, device or time permissions.

## 1 Authentication

Log in, open Data integration, and generate a token under My API access tokens. External programs send Authorization: Bearer YOUR_TOKEN. A logged-in same-origin browser may use its session cookie. Revoking a token stops applications using it. Never commit real tokens.

```http
Authorization: Bearer YOUR_TOKEN
```

Use the institution's configured HTTPS base URL, for example `https://api.lunglab.rcec.sinica.edu.tw`. The example does not establish current DNS readiness. A local example is `http://127.0.0.1:3105`; use your actual development port.

## 2 Endpoint and permissions

GET /api/data provides ASLUNG measurements. The server checks role, device, tracking segment and time grants. Viewers may query but cannot download measurements. Other non-admin roles still need data grants. Without segment_id, the whole requested interval must be authorized. With segment_id, the server queries the permitted intersection for that tracking segment.

Non-admin queries and downloads are limited to 31 days. Admin is exempt from that date limit but remains subject to export, result-version and resource protections. Creating background processing jobs is independently limited to 31 days per request even for admin.

## 3 Request parameters

| Parameter | Required | Meaning |
| --- | --- | --- |
| aslung_id | Yes | Registered ASLUNG device ID |
| start | Yes | Start time; explicitly zoned ISO 8601 recommended |
| end | Yes | End time, not before start; both endpoints inclusive |
| segment_id | No | Authorized tracking segment |
| cursor | No | Previous next_cursor; treat as opaque |
| calibration | No | raw default; both coefficient calculation; processed full background results |
| calibration_snapshot | No | Reuse the returned both/processed snapshot |
| download | No | 1 for a full download; otherwise paginated JSON |
| format | No | csv or json; csvzip/jsonzip also accepted; all downloads are ZIP |

Use a timestamp such as 2026-10-01T00:00:00+08:00 or 2026-09-30T16:00:00Z. Encode a plus sign as %2B. Prefer requests params or URLSearchParams. Although the server accepts some compatible Taiwan date forms, external programs should always provide an explicit timezone.

raw applies no coefficient. both retains originals and adds calibrated values, status and coefficient versions; equality at a breakpoint uses segment 2, and negative results are preserved. processed reads completed six-rule results rather than calculating them on demand. Incomplete coverage returns 409 without raw fallback, and actual Ghost Peak context samples must also be authorized.

## 4 Fields and quality

| Field | Mapping or interpretation |
| --- | --- |
| timestamp | UTC ISO 8601 measurement time normalized from time |
| aslung_id / uid | Device identity; original names/aliases depend on mode |
| PM1_G3, PM2.5_G3, PM10_G3 | Original G3 channels ch1 to ch3 |
| temperature, rh, co2 | Original ch4 to ch6 readings |
| battery | Raw ch7; device-defined units, not necessarily percent |
| acc_x, acc_y, acc_z | Original ch8 to ch10 |
| gps, gps_speed, gps_direction, gps_height | ch11 to ch14; encoding/units depend on device |
| air_pressure, noise1, noise2, noise3 | Original ch21 to ch24 |
| PM1_GSA, PM2.5_GSA, PM10_GSA | ch29 to ch31, processed separately from G3 |
| Num_0.3_GSA through Num_10_GSA | Original ch32 to ch37 number channels |
| ch* and other source columns | Current full-field outputs preserve rawdata columns |
| clean, calibrated and final suffixes | Cleaning, coefficient and full-pipeline output as applicable |
| calibration status/version fields | Preserve for traceability |
| _quality and _background_status | Full-pipeline flags and context information |

Sources may return numbers or numeric strings. Current calculations parse finite decimal strings while retaining original types. Null/blank is not zero. NO_FACTOR means no applicable coefficient; INVALID_RAW means invalid source input; CONFLICT or FACTOR_CONFLICT indicates ambiguous coefficients. Quality counts can include several flags on one observation and are not a count of deleted rows. See the website field guide for all fields and rules.

## 5 Responses and downloads

Ordinary paginated JSON normally returns up to 1,000 observations with data, has_more, next_cursor, calibration, calibration_snapshot and authorization metadata. Processed mode adds result-specific job/snapshot information. Follow has_more and next_cursor rather than guessing total history from an empty page.

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

With download=1, csv/csvzip returns a ZIP containing CSV, and json/jsonzip returns a ZIP containing JSON. Filenames use the device and Taiwan dates. The server streams and combines pages with iteration protections; excess data causes an error rather than silent truncation. The old fixed 50,000-row statement is obsolete. Inspect Content-Type and the actual downloaded file rather than assuming plain CSV or JSON.

## 6 Program example

This example uses a placeholder device and environment variables. Supply a working URL, token and data authorization.

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

Website batch downloads additionally include a bilingual download_manifest.txt. Export success means the file was produced, not that every channel passed all quality conditions. Preserve manifests and versions.

## 7 Errors

| HTTP | Action |
| --- | --- |
| 400 | Correct dates, parameters, mode or the non-admin 31-day interval |
| 401 | Log in or check the ASLUNG token |
| 403 | Check device/segment/time grants, viewer restrictions and context permission |
| 404 | Check that the device, job or file exists |
| 409 | Wait for complete results or obtain a fresh snapshot/query |
| 413 | Shorten the export interval or reduce result versions |
| 502 or 503 | Check source, S3, configuration and worker; do not interpret as zero records |

Avoid endless retries. Provide an administrator with the HTTP code, sanitized message, device and interval. The health endpoint does not validate every external service.

## 8 Website HOBO query API

HOBO and original ASLUNG observations are different datasets. GET /api/hobo currently requires admin. It searches imported local/S3 data and does not expose the LI-COR token to the browser.

| Parameter | Meaning |
| --- | --- |
| action | query for pages; csv for a direct CSV; omitted for admin status |
| serial | Logger Serial Number; required for query/csv |
| start, end | Explicitly zoned ISO 8601, inclusive |
| measurement | Optional case-insensitive substring of measurement type |
| sensor | Optional case-insensitive substring of sensor serial |
| q | Optional keyword across original fields; search strings limited to 160 characters |
| after | Previous numeric next for query; first page 0 |

query returns rows and next, up to 200 observations per page. next=null ends pagination. csv applies the same filters to all matching observations and returns direct CSV, unlike ASLUNG ZIP exports. Fields are logger_sn, sensor_sn, timestamp, data_type, data_type_id, value, unit and sensor_measurement_type, preserving UTC and source units. POST imports, cancellation, bulk operations and permanent cleanup are administrative actions that also require an Origin matching APP_ORIGIN. Keep research download scripts separate from destructive administration.
