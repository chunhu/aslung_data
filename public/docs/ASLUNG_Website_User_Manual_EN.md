# ASLUNG Website User and Administration Manual

Revision date: 22 October 2026. Audience: researchers, device and calibration managers, website administrators and EC2 operators.

This manual covers access, permissions, measurement queries, calibration, device operations, HOBO imports and maintenance of the service. Check your account role, data grants and displayed timezone before operating. Removing a sync job record is different from permanently deleting measurement files. Features described here may require deployment and configuration; their presence in the code does not establish that DNS, schedules or historical imports are already active.

## 1 Connecting and navigating

Use the HTTPS address for which your institution has completed DNS and TLS configuration. The intended domain is `https://api.lunglab.rcec.sinica.edu.tw`; ask the network administrator to confirm readiness. An address such as `127.0.0.1:3105` refers to the computer opening it and is not a public EC2 address.

A Welcome to nginx page at the EC2 public IP means the request reached Nginx but was not routed to this application. An administrator must configure the reverse proxy or provide an approved SSH tunnel. Do not expose Docker port 3000 directly. A stop/start can change an automatically assigned public IP, so an old screenshot is not evidence of the current address.

Available sidebar modules depend on your role. The header provides timezone and text-size settings, and the language button switches Chinese and English. Read the timezone label on each date form. Exported timestamp values normally use UTC; Z means UTC. Taiwan time is UTC plus eight hours. A displayed dash, blank CSV cell or JSON null is a missing value, not numeric zero.

## 2 Registration and personal settings

1. Apply from the login page with your name, Email, login name, password, country or region, organization or team, project name and description.
2. Open the verification message and confirm on the verification page. The link is valid for 24 hours. Resending requires the original Email and password.
3. Wait for administrator review. Email verification and approval are separate steps. Approval enables the account but does not assign devices or files.
4. After login, change your password, complete My collaboration profile, and configure alert Email preferences. Ask an administrator to reset a forgotten password using the terminal tool.

Public registration requires SMTP configuration. The system rejects registration clearly when mail is unavailable; administrators can still create accounts and deliver initial credentials separately. Changing or resetting a password, or disabling an account, invalidates existing login sessions. Treat API tokens as secrets and keep them out of shared documents, public scripts and Git.

## 3 Roles and independent permission scopes

| Role | Administrative scope | Measurement access |
| --- | --- | --- |
| System administrator admin | Members, devices, permissions, calibration, HOBO and settings | All measurements |
| Device manager device_manager | Status, deployment, maintainers and maintenance of explicitly assigned devices | Separate data grants still required |
| Calibration manager calibration_manager | Calibration sources, synchronization, coefficients and versions | Separate data grants required; background job administration remains admin only |
| Research member member | Personal settings and maintenance responsibility permitted to that account | Queries and downloads within device, site and time grants |
| Viewer viewer | Personal settings and permitted viewing | Queries permitted; measurement download and batch export prohibited |

Roles, device management scopes, measurement grants, maintainer identities and file grants are separate. Device administration does not grant measurement downloads, and matching names do not establish a maintainer identity. Administrators configure roles and scopes in member management, measurement grants in data permissions, responsibilities in maintainer links, and file grants in the files module.

Device grants can have start and end times. Site grants expand through the devices' tracked deployment intervals at that site. Choose a permitted tracking segment or shorten a query that crosses unauthorized gaps. Non-admin ASLUNG measurement queries and downloads are limited to 31 days; admin is exempt from this date limit, but individual processing and export limits still apply.

## 4 Realtime device status

The realtime page shows the latest authorized record, current location, connection status and raw G3, GSA, temperature, humidity, CO2 and battery readings. Battery comes from ch7; do not assume a percentage without the device data dictionary. Search by device or location, refresh manually or change refresh frequency. Administrators can set the site default; members change their browser preference.

Undeployed devices that have not reported for over one year are hidden from this page rather than deleted. Deployed devices remain visible even when long offline. Admin can manually discover unregistered devices over 1, 7, 30 or 365 days, up to 200 results, inspect their latest measurements and register them. Registration does not create member data grants.

## 5 ASLUNG queries and batch exports

1. Open Data query and select a device and tracking segment using the searchable selector.
2. Check the permitted interval and set the start, end and timezone.
3. Choose raw measurements, raw plus coefficients calculated at query time, or completed six-rule processed results.
4. Submit the query and check its loading, success or error message. The field guide opens a separate Chinese or English reference and offers a downloadable copy.
5. Export one condition or add several conditions to a batch. Batch export produces a ZIP with a bilingual download_manifest.txt; daily results do not require individual manual downloads.

Full ASLUNG CSV and JSON downloads are ZIP files generated by the server. Do not read the ZIP response as plain CSV. Filenames use the device and Taiwan dates, with a tracking-segment suffix where needed to avoid collisions. A query page is only part of the data; a download assembles the authorized range. Read failures and missing-result entries in the batch manifest. Export success does not mean every channel has a valid calibrated value.

Ordinary query start and end are inclusive. Daily background processing uses an inclusive start and exclusive end: processing 1 October ends at midnight on 2 October. Preserve the manifest, processing version and quality flags for reproducible analysis.

## 6 Calibration modes and output fields

| Mode | Source and purpose | Important behavior |
| --- | --- | --- |
| raw | Original MySQL measurements and readable aliases | No coefficient applied |
| both | Original values plus slope times raw plus intercept | Not full six-rule cleaning; negative results preserved |
| processed | Completed background results with sufficient authorization | Incomplete coverage is an error; raw data is not used to fill gaps |

The clean suffix identifies cleaning output; calibrated is the coefficient result; final also includes the PM1 cap and rule 6. Quality, background status, processing version and job identifiers support interpretation. Current full-field results preserve original columns and readable aliases. Older files are not supplemented live from MySQL; create a new processing version to obtain missing fields.

NO_FACTOR means no applicable coefficient exists for that device, channel and measurement time. INVALID_RAW means the value cannot be parsed into a finite number; current processing accepts finite decimal numeric strings. FACTOR_CONFLICT or CONFLICT indicates overlapping or ambiguous coefficients. CLEAN_MISSING indicates a missing cleaned value; NEAR_EQUAL_NOT_EVALUABLE indicates insufficient raw values for rule 6. NO_Factoe is a spelling error; the implemented status is NO_FACTOR.

The six rules cover identical high PM values and low values, Ghost Peak cleaning, low temperature/humidity/CO2 readings, coefficient calibration, the PM1-to-PM2.5 cap, and the high-PM1 near-equality exclusion. G3 and GSA are independent. Negative calibration results become missing in the full pipeline. Multiple flags can occur on one row and across channels, so their counts cannot be summed into a number of deleted records.

## 7 Coefficient sources and background processing

Create one calibration source per Google spreadsheet tab, with a URL, name and description. Sync now processes only that source. Required headers include aslung_id, PM, slope1, intercept1 and Start_date; end date and second-segment fields are optional. PM1, PM2.5 and PM10 map to G3; GSA has separate channels. PM125 and UNMAPPED entries remain lookup-only.

Source dates use Taiwan time and are stored as inclusive-start, exclusive-end intervals. An open-ended record can connect to the next record in the same source. Valid same-day handovers activate the new coefficient that day. Invalid fields, duplicate starts or conflicting intervals reject the entire update and preserve the last successful version. Import history provides complete reports and source versions beyond the short source-card message.

Enabled sources are checked daily at 02:00 Taiwan time, with catch-up after downtime. Private spreadsheets require a server-side read-only service account and viewer access. Never commit its credentials. Disabling a source preserves its history but removes its current coefficients from normal application.

Admin creates daily background jobs for a device and up_limit, default 3, for up to 31 days per request; recalculation creates a new version. Global scheduling must be enabled explicitly. After 03:00 it checks the latest three complete days; older history requires a manual job. Jobs remain queued without the worker. History provides device/date/status filters and 20 records per page. Open details for rules and quality, then explicitly load a preview or download a daily result.

## 8 Device inventory deployments and maintainers

Inventory supports status, site, maintainer, connection and quality filters, device histories, CSV export, QR codes, quick updates and batch actions. Status changes or transfers may end active deployments. Check effective dates and the proposed scope before confirming. A device with maintenance history cannot be directly deleted; use a retired status when appropriate.

The site library stores Lab IDs and geographic/site descriptions. Deployment tracking preserves device, site, start and end history. Google and CSV/TSV imports follow source selection, column mapping, preview and apply. Records absent from a source are not automatically removed. An unknown maintainer name produces a warning and is still imported; complete their contact information afterward.

Maintainers can have Chinese and English names, primary and test Email addresses. Chinese preserves the original name; English prefers the configured English name. Administrators establish explicit member-to-maintainer links or matching Email identities. Measurement access and maintenance responsibility must not be inferred from one another.

## 9 Maintenance and repairs

Create repair, routine service, calibration and part-replacement records. Move through pending, in progress, awaiting acceptance and completed, or cancel with a reason. Records retain the deployment and maintainer snapshot, assignee, vendor, costs, actions and acceptance history.

Admin may place a device in maintenance and end its deployment. Returning it to standby after acceptance does not redeploy it. Other open orders can prevent an early status change. Completed records are corrected by appended notes rather than overwritten. Attachments accept PDF, PNG, JPEG and WebP, up to 5 MB each and 20 per order, stored in SQLite and included in its backup.

Access for ordinary accounts depends on current deployment responsibility, record creator, assignment, role and device management scope. Viewers cannot write. Data read access or an identical name is insufficient. The current version provides on-screen due-date reminders, not automatic recurring orders or maintenance-due Emails.

## 10 Alerts and shared files

Admin configures SMTP, check frequency, timezone and the offline threshold before enabling alerts. Recipients follow current device maintenance responsibility and contact details. Member Email preferences affect device alerts, not registration or review mail. Never-reporting devices and those whose last report predates a calendar year may remain visible warnings but are excluded from alert Email; query failures are unknown status.

Test Email mode still respects the primary contact member's opt-out preference. Use the logs to distinguish detection, skips, successful delivery and failure. Recipient counts reflect successful sends. After repairing SMTP, check registration/review mail independently.

The files module lets admin upload files with descriptions and grant member access. Members can view or download their granted files. File permissions are independent of measurement grants. Ordinary uploaded file bodies are stored separately on the server, so SQLite backup alone does not back them up. Maintenance attachments are stored inside SQLite.

## 11 HOBO devices and historical imports

HOBO is currently admin only. Configure LICOR_API_TOKEN in the server .env; ordinary members do not enter this token. A personal ASLUNG API token and the LI-COR token are not interchangeable.

1. Choose a logger from the searchable dropdown to see one device summary and local/S3 counts.
2. Expand device/import/schedule settings. Batch setup is prefilled with the 24 supplied logger serials and is editable. The initial start is 1 January 2025 at Taiwan midnight, through the time the import is submitted.
3. Check Logger Serial Number, name, start date and the optional hourly schedule before saving or queuing.
4. Monitor monthly progress, daily cursor and errors. History is divided by Taiwan calendar month, with requests no larger than a day inside each month. S3 remains organized by device day.

All devices share a default 15-second request interval, including split requests. A device pauses 60 seconds after completing a month. HTTP 429 or 509 triggers a shared cooldown of at least five minutes, increasing to 60 minutes for repeated throttling and honoring a longer Retry-After. SQLite preserves progress and the next allowed request time across restarts. These are conservative application defaults, not a statement of LI-COR's contracted quota.

When max_results is true, the application splits the interval rather than accepting truncated data; saturation at a one-second interval is an error. HTTP 200 with empty data only establishes that no observations were returned for that request; it does not prove complete access or absence of all history. Ordinary failures have three attempts before manual retry; rate limits do not consume that budget. Repeated HTTP 400 requires checking logger IDs, dates and the provider's actual validation rules rather than repeatedly retrying blindly.

## 12 HOBO searching cancellation and deletion

The separate search section filters imported local and S3 observations by device, dates in the selected timezone, measurement, sensor serial and keyword. Conditions combine. Keywords can match other measurement names, units, values and data types. Queries return 200 matching observations at a time; load more retains the conditions. Full CSV uses the same filters and is a direct CSV, unlike ASLUNG ZIP exports. Changing conditions clears stale results and download links.

HOBO uses a long table: each row is one sensor observation. Fields include logger_sn, sensor_sn, timestamp, sensor_measurement_type, value, unit, data_type and data_type_id. Preserve provider units for temperature, humidity, dew point, wind, rain, PAR, solar radiation and battery. Data is neither mapped to ASLUNG PM channels nor calibrated with ASLUNG coefficients.

| Operation | Stops or removes | Preserves |
| --- | --- | --- |
| Cancel or bulk cancel | Future fetches/retries and the affected device schedule | Imported observations, committed progress and job record |
| Delete job record or bulk delete | Selected inactive jobs and month checkpoints | Device, local data, S3 objects and archive index |
| Clear HOBO data | Selected whole Taiwan days of local data, S3 generations/versions and related records | Device, cleanup audit, separate backups and previously downloaded files |

Bulk selection covers the currently listed latest 30 jobs; the confirmation freezes their IDs. Queued, running and failed jobs can be cancelled; completed/cancelled jobs are skipped. Active jobs must be cancelled before record deletion, which requires DELETE. An invalid member of a deletion batch rejects the whole batch. In-flight cancellation attempts to abort HTTP and discards responses that have not been committed.

For permanent cleanup, choose devices and whole Taiwan dates, preview and type DELETE. The system backs up SQLite, disables schedules and cancels unfinished imports. The worker removes every S3 generation, version and delete marker in each device-day scope, then local observations and indexes. Permission or partial-delete failures preserve local references for retry. Preview expires after 15 minutes, with at most 20,000 device days per batch. S3 preview counts describe indexed scopes, not a complete historical version inventory. Later manual import or schedule re-enablement can retrieve the original provider data again.

## 13 Clearing ASLUNG processed results

Admin applies device/date/status filters to processing history and previews cleanup. It covers all pages, up to 500 jobs, excluding running or uploading jobs. Confirmation requires DELETE; disabling global and selected per-device schedules is selected by default.

After SQLite backup, the worker removes local results, corresponding S3 versions, related job and query snapshot records, retaining retry state on failure. Original MySQL measurements, members, devices and coefficients remain. Backups, downloaded ZIPs, orphan files without job records and processed/_checks are outside this cleanup. SQLite backup alone cannot restore permanently deleted S3 results.

## 14 API and analysis programs

Generate a personal token in Data integration and send Authorization: Bearer TOKEN to /api/data. Logged-in same-origin browsers can use a session cookie. Tokens do not expand permissions; viewers still cannot download measurements. Revoking a token stops applications that use it.

Provide aslung_id, start and end; use cursor for pagination, segment_id for a tracking segment, and calibration for raw, both or processed. Add download=1 and format=csv or json for ZIP exports. Do not parse their response body as plain measurement JSON. Reuse calibration_snapshot in both and processed modes to keep a consistent coefficient/result version.

The admin-only /api/hobo query and csv actions support measurement, sensor and q. This is the website's endpoint, not the original LI-COR API. See the Chinese and English API guides for complete parameters and executable examples.

## 15 Deployment and storage

The backend currently reads MySQL rawdata directly using MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD and MYSQL_DATABASE. The old description of an external measurement API awaiting development is obsolete. SQLite holds identities, grants, deployments, calibration/HOBO settings, progress and indexes. CALIBRATION_STORAGE controls processed-result storage; HOBO_STORAGE controls HOBO independently.

```dotenv
APP_ORIGIN=https://your-approved-host.example
DATABASE_PATH=/app/data/aslung.sqlite
BACKUP_PATH=/app/backups
MYSQL_HOST=your-mysql-host
MYSQL_USER=your-readonly-user
MYSQL_PASSWORD=your-secret
MYSQL_DATABASE=your-database
CALIBRATION_STORAGE=s3
HOBO_STORAGE=s3
AWS_REGION=ap-northeast-1
S3_BUCKET=your-bucket
LICOR_API_TOKEN=your-private-token
HOBO_API_INTERVAL_MS=15000
HOBO_MONTH_PAUSE_MS=60000
```

Use the EC2 IAM Role for S3. Scope existing read/write access to processed/* and hobo/* respectively. Add scripts/iam-calibration-cleanup.json and scripts/iam-hobo-cleanup.json for cleanup without replacing read/write policies. Adjust example bucket names to the deployment. Do not publish long-lived AWS keys.

```bash
cd ~/aslung-deployment/aslung_data
sudo bash scripts/deploy_cal.sh
sudo docker compose --profile calibration ps -a
curl -sS --max-time 15 http://127.0.0.1:3000/api/health
sudo docker compose --profile calibration logs --tail=80 calibration-worker
```

The deployment script builds, checks and backs up before updating the app and worker. It does not enable schedules that are disabled in the database. Recreate containers after changing .env; restart alone does not reload container environment variables. Explicitly start a manually stopped worker. Boot recovery depends on Docker, Nginx and container restart settings; an EC2 running state is not sufficient proof of website health.

HOBO verifies device-day uploads before removing staged local rows, and gradually migrates existing local observations. Processed ASLUNG results currently retain local files for caching/recovery. Old HOBO S3 generations remain until cleanup, so monitor storage. Deleting SQLite rows makes pages reusable but does not necessarily shrink the database file.

## 16 Backups and troubleshooting

Back up SQLite, ordinary uploaded files, processed results, S3 observations and protected configuration separately as appropriate. A SQLite hot backup excludes external files and S3 objects. Keep an offsite copy and test restoration. Stop both app and calibration-worker before restoring the database and handling its WAL consistently. Never overwrite an actively written database. See the deployment guide for exact commands.

| Symptom | First checks |
| --- | --- |
| Login fails or devices are missing | Activation, review, role and grants; names do not establish identity |
| Query appears to do nothing | Loading/error messages, segment/date and complete processed coverage |
| Blank calibration values | NO_FACTOR, INVALID_RAW, source version and quality; do not replace missing values with zero |
| Old screen after deployment | Deployed commit, image version, reload/login; existing downloads do not update themselves |
| Entire site is slow | free -h, vmstat and iostat; investigate memory/swap and I/O wait |
| HOBO remains queued | Worker, shared request interval, month pause, Retry-After, token and S3 archive errors |
| HTTP 400 or 403 | Parameters, dates, permissions and provider rules; errors are not proof of no data |
| S3 cleanup keeps retrying | Delete/version-list permissions, bucket and Object Lock restrictions; do not delete indexes to fake success |

A health response of ok only shows that the application responds; it does not validate MySQL, SMTP, LI-COR or S3. Validate one device-day through query, export and permissions before a large history import. No real passwords, tokens or member records are included in this manual.
