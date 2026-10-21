import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

// One source for the online page and the downloadable, self-contained HTML.
const raw=[
  ['timestamp','量測時間；匯出為 UTC ISO 8601，結尾 Z 代表 UTC。畫面依所選時區顯示。','Measurement time exported as UTC ISO 8601; Z indicates UTC. The app displays the selected timezone.'],
  ['id','原始量測記錄編號，用於追查與分頁，不是設備編號。','Original measurement record ID used for traceability and pagination; not the device ID.'],
  ['aslung_id / uid','設備編號；aslung_id 是原始 uid 的易讀欄位名稱。','Device ID. aslung_id is the readable alias of the original uid.'],
  ['PM1_G3 / PM2.5_G3 / PM10_G3','G3 感測器的三個原始 PM 通道，分別對應 ch1／ch2／ch3。','Three raw G3 PM channels, corresponding to ch1 / ch2 / ch3.'],
  ['temperature / rh / co2','原始溫度、相對濕度與 CO₂，分別對應 ch4／ch5／ch6。','Raw temperature, relative humidity and CO₂, corresponding to ch4 / ch5 / ch6.'],
  ['battery','電池量測原值（ch7），單位與定義依設備資料字典。','Raw battery measurement (ch7); units and interpretation follow the device data dictionary.'],
  ['acc_x / acc_y / acc_z','三軸加速度原值（ch8／ch9／ch10）。','Raw acceleration axes (ch8 / ch9 / ch10).'],
  ['gps','GPS 定位原值（ch11），保留設備回傳格式。','Raw GPS value (ch11), preserving the device encoding.'],
  ['gps_speed / gps_direction / gps_height','GPS 速度、方向與高度原值（ch12／ch13／ch14）。','Raw GPS speed, direction and height (ch12 / ch13 / ch14).'],
  ['air_pressure','氣壓原值（ch21）。','Raw air pressure (ch21).'],
  ['noise1 / noise2 / noise3','三個噪音量測原值（ch22／ch23／ch24）。','Three raw noise measurement channels (ch22 / ch23 / ch24).'],
  ['PM1_GSA / PM2.5_GSA / PM10_GSA','GSA 感測器的三個原始 PM 通道，分別對應 ch29／ch30／ch31；與 G3 分開處理。','Three raw GSA PM channels, corresponding to ch29 / ch30 / ch31; processed separately from G3.'],
  ['Num_0.3_GSA / Num_0.5_GSA / Num_1.0_GSA','GSA 粒徑數量通道原值（ch32／ch33／ch34），單位依設備定義。','Raw GSA particle-size number channels (ch32 / ch33 / ch34); units follow the device definition.'],
  ['Num_2.5_GSA / Num_5.0_GSA / Num_10_GSA','GSA 粒徑數量通道原值（ch35／ch36／ch37），單位依設備定義。','Raw GSA particle-size number channels (ch35 / ch36 / ch37); units follow the device definition.'],
  ['ch* / 其他原始欄位','完整欄位成果保留 rawdata 的原始欄名與內容；未建立易讀名稱的通道仍以 ch* 呈現。原始 time 轉為 timestamp。','Full-field results retain rawdata column names and content. Unmapped channels retain ch* names. Original time is normalized to timestamp.'],
];
const stages=[
  ['PM1_G3 / PM2.5_G3 / PM10_GSA','原始 PM 量測值的欄位範例，保留不變。','Example raw PM fields, preserved without replacement.'],
  ['*_clean','完成 PM 異常值與 Ghost Peak 清理，尚未套用係數。','After PM anomaly and Ghost Peak cleaning, before coefficient calibration.'],
  ['*_calibrated','對清理值套用量測當時適用的係數：a × x + b。六項規則模式中，非有限或負值結果留空。','Applicable measurement-time coefficient applied to the cleaned value: a × x + b. In six-rule mode, non-finite or negative results are blank.'],
  ['*_final','在校正值之後，完成 PM1 不高於 PM2.5 的調整與第六項排除規則。PM 分析通常使用此欄，並檢查品質旗標。','After the PM1 cap and rule 6 exclusion. Usually the PM analysis value; also inspect quality flags.'],
  ['temperature_clean / rh_clean / co2_clean','依第三項規則清理；小於 1 或無效值留空。這三欄沒有套用 PM 校正係數。','Cleaned under rule 3; values below 1 or invalid values are blank. No PM calibration coefficient is applied to these fields.'],
];
const meta=[
  ['*_calibration_version','該 PM 通道適用的係數版本 ID；有版本 ID 不代表清理值或校正結果一定有效。','Applicable coefficient version ID for that PM channel; its presence does not guarantee a valid cleaned or calibrated value.'],
  ['*_calibration_record','該 PM 通道使用的係數記錄 ID，供追查來源與適用期間。','Coefficient record ID for tracing the source and applicable period.'],
  ['_processing_version','完整六項規則版本，例如 six-rules-2。數字字串支援以此版開始；舊工作仍沿用原本版本。','Full six-rule recipe version, such as six-rules-2, which introduced numeric-string support. Old jobs keep their pinned version.'],
  ['_processing_job_id','資料查詢合併成果時附上的工作 ID；單工作下載不一定有此欄。','Job ID attached by merged processed queries; may be absent from an individual job download.'],
  ['_processing_up_limit','資料查詢合併成果時附上的第六項門檻，預設 3；以該工作實際參數為準。','Rule 6 threshold attached by merged processed queries; default 3, subject to the job’s pinned parameter.'],
  ['_background_status','COMPLETE：前後背景樣本充足。INSUFFICIENT_CONTEXT：前後背景不足，後續補資料後可重新計算；不代表整筆資料自動排除。','COMPLETE: sufficient surrounding samples. INSUFFICIENT_CONTEXT: insufficient surrounding samples; recompute after more data arrives. This does not automatically discard the row.'],
  ['_quality','JSON 物件，依通道列出處理旗標。CSV 中保留 JSON 文字；空物件 {} 表示該筆沒有記錄旗標。','JSON object containing flags per channel. CSV retains the JSON text. An empty object {} means no flags were recorded for the row.'],
];
const flags=[
  ['INVALID_RAW','原始值缺漏、無法解析或不是有限數值；舊版也可能把數字字串判為此旗標。','Missing, unparseable or non-finite input; legacy jobs may also flag numeric strings.'],
  ['PM_EQUAL_HIGH','同組 PM1、PM2.5、PM10 相等且大於 50，清理值留空。','All three PM values in the sensor group are equal and greater than 50; cleaned values are blank.'],
  ['PM_BELOW_ONE','該 PM 原始值小於 1。','This raw PM value is below 1.'],
  ['GHOST_PEAK','PM2.5 前後兩個方向皆未通過 Ghost Peak 判斷；該組三個 PM 清理值排除。','Neither direction retains PM2.5 in Ghost Peak detection; all three PM channels in that sensor group are excluded.'],
  ['CLEAN_MISSING','沒有有效清理值，無法進行後續校正。','No valid cleaned value is available for calibration.'],
  ['NO_FACTOR','量測時間及通道找不到適用係數；原始與清理值仍可能有效。','No applicable coefficient for this measurement time and channel; raw and cleaned values may still be valid.'],
  ['FACTOR_CONFLICT','同時間與通道對應多筆係數，未套用校正。','Multiple matching coefficients; calibration was not applied.'],
  ['INVALID_CALIBRATED','校正計算產生非有限結果。','Calibration produced a non-finite result.'],
  ['NEGATIVE_CALIBRATED','完整六項規則模式的校正結果小於 0，校正值及最終值留空。','Six-rule calibration result was negative; calibrated and final values are blank.'],
  ['PM1_CAPPED_TO_PM25','同組有效 PM1 最終值大於 PM2.5，PM1 已調整為 PM2.5。','Valid PM1 exceeded PM2.5 in the sensor group; PM1 was capped to PM2.5.'],
  ['PM_NEAR_EQUAL_HIGH','原始 PM1 大於 50，且與三個原始 PM 平均的絕對差小於或等於 up_limit；同組三個 PM 最終值留空。','Raw PM1 > 50 and its absolute difference from the mean of the three raw PM values is ≤ up_limit; all three final PM values are blank.'],
  ['NEAR_EQUAL_NOT_EVALUABLE','同組原始 PM 不完整，無法評估第六項；不代表因此額外排除所有有效通道。','Incomplete raw PM group prevents rule 6 evaluation; this flag alone does not additionally discard valid channels.'],
  ['BELOW_ONE','溫度、濕度或 CO₂ 的原始值小於 1。','Raw temperature, humidity or CO₂ was below 1.'],
];
const coefficientFlags=[
  ['CALIBRATED','已完成單純係數計算。','Coefficient calculation succeeded.'],
  ['INVALID_RAW','原始值缺漏、無法解析或不是有限數值。支援十進位數字字串（含前後空白、小數及科學記號）。','Missing, unparseable or non-finite input. Decimal numeric strings, including surrounding whitespace, decimals and scientific notation, are accepted.'],
  ['CONFLICT','有多筆適用係數。','Multiple coefficients match.'],
  ['NO_FACTOR','沒有適用係數。','No applicable coefficient.'],
  ['INVALID_RESULT','計算結果不是有限數值。','Result is not finite.'],
];
const rules=[
  ['同組三個 PM 相等且大於 50 時排除三者；各 PM 小於 1 時個別排除。','Exclude all three PM channels when equal and > 50; exclude individual PM values below 1.'],
  ['Ghost Peak 以 PM2.5 為判斷基礎，正向及反向各迭代 5 次，使用前 5 筆中的有效值平均，比值需 < 10 才保留；兩個方向皆未保留時排除該組三個 PM。不是只看單次「超過平均十倍」。','Ghost Peak uses PM2.5, five passes in each direction and the valid values among the preceding five samples. A ratio < 10 is retained. If neither direction retains the sample, all three PM channels in the group are excluded. It is not a single ten-times-average test.'],
  ['溫度、濕度、CO₂ 小於 1 或無效時清理值留空；原始欄位保留。','Cleaned temperature, humidity and CO₂ are blank for invalid values or values below 1; raw fields are retained.'],
  ['依設備、通道及量測時間選係數。x < break_point1 才採第一段；等於分段點採第二段。未提供第二段時全程採第一段。非有限或負校正結果留空。','Select coefficients by device, channel and measurement time. Segment 1 uses x < break_point1; equality uses segment 2. Without segment 2, use segment 1 throughout. Non-finite or negative calibrated results are blank.'],
  ['若同組有效校正 PM1 > PM2.5，PM1 最終值改為 PM2.5。','If valid calibrated PM1 > PM2.5 in the same group, cap final PM1 to PM2.5.'],
  ['以原始三個 PM 計算：rawPM1 > 50 且 |rawPM1 − (rawPM1 + rawPM2.5 + rawPM10) / 3| ≤ up_limit 時，同組三個 PM 最終值留空。up_limit 預設 3。','Using the three raw PM values: if rawPM1 > 50 and |rawPM1 − (rawPM1 + rawPM2.5 + rawPM10) / 3| ≤ up_limit, all three final PM values are blank. Default up_limit: 3.'],
];
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function fieldGuideHtml(language){
  const en=language==='EN',index=en?2:1,t=(zh,english)=>en?english:zh;
  const table=(rows)=>`<div class="table-wrap"><table><thead><tr><th>${t('欄位／代碼','Field / code')}</th><th>${t('說明','Description')}</th></tr></thead><tbody>${rows.map(row=>`<tr><td><code>${escape(row[0])}</code></td><td>${escape(row[index])}</td></tr>`).join('')}</tbody></table></div>`;
  const filename=`ASLUNG_Data_Fields_${language}.html`;
  return `<!doctype html>
<html lang="${en?'en':'zh-Hant'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t('ASLUNG 欄位資料說明','ASLUNG field documentation')}</title>
<style>
:root{color-scheme:light;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#193345;background:#f3f6f8;line-height:1.75}*{box-sizing:border-box}body{margin:0}main{max-width:1060px;margin:36px auto;padding:28px;background:white;border:1px solid #d9e3ea;border-radius:16px}h1{font-size:1.8rem;line-height:1.4}h2{margin-top:2.4rem;font-size:1.25rem}p,li{overflow-wrap:anywhere}.muted{color:#64748b;font-size:.9rem}.notice{padding:14px 18px;border-left:4px solid #32766f;background:#edf8f5}.actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center}a{color:#226e68}button,.button{border:1px solid #32766f;background:white;color:#205b56;padding:9px 15px;border-radius:8px;font:inherit;cursor:pointer;text-decoration:none}.primary{background:#32766f;color:white}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:.92rem}th,td{padding:12px;border:1px solid #dce5eb;text-align:left;vertical-align:top}th{background:#f1f6f8}td:first-child{width:32%;overflow-wrap:anywhere}code{font-family:ui-monospace,Consolas,monospace;font-size:.9em;white-space:normal}nav{padding:16px;background:#f8fafb;margin:22px 0}nav a{display:inline-block;margin:3px 16px 3px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;background:#f3f6f8}@media(max-width:640px){main{margin:0;padding:18px;border:0;border-radius:0}h1{font-size:1.5rem}th,td{padding:9px}}@media print{body{background:white}main{max-width:none;margin:0;padding:0;border:0}.actions,nav{display:none}h2{break-after:avoid}tr{break-inside:avoid}a{color:inherit}.table-wrap{overflow:visible}}
</style></head><body><main>
<header><p class="muted">ASLUNG DATA MANAGEMENT</p><h1>${t('欄位資料說明','Field documentation')}</h1><p class="muted">${t('更新日期：2026/10/21 · 完整處理版本：six-rules-2 · 完整原始欄位：all-fields-1','Updated: 2026-10-21 · Processing: six-rules-2 · Full raw fields: all-fields-1')}</p>
<div class="actions"><a class="button primary" href="./${filename}" download="${filename}">${t('下載說明文件（HTML）','Download documentation (HTML)')}</a><button type="button" onclick="window.print()">${t('列印／另存 PDF','Print / save as PDF')}</button><a href="./ASLUNG_Data_Fields_${en?'ZH':'EN'}.html">${en?'繁體中文':'English'}</a></div><p class="muted">${t('HTML 文件可離線閱讀；下載後以瀏覽器開啟即可。PDF 請使用列印功能選擇「另存為 PDF」。','The HTML file can be read offline in a browser. To create a PDF, choose Save as PDF in the print dialog.')}</p></header>
<p class="notice">${t('PM 分析通常使用 *_final，並搭配 _quality 與 _background_status 檢查。CSV 空白、JSON null 或畫面「—」代表沒有有效結果，不代表 0。原始值會保留；同一筆資料可有多個旗標。','For PM analysis, usually use *_final and inspect _quality and _background_status. Blank CSV cells, JSON null and a displayed dash indicate an unavailable value, not zero. Raw values are preserved; a row may have multiple flags.')}</p>
<nav aria-label="${t('文件目錄','Contents')}">${[['modes',t('查詢模式','Query modes')],['raw',t('原始欄位','Raw fields')],['stages',t('校正階段','Processing stages')],['meta',t('版本與品質','Versions and quality')],['rules',t('六項規則','Six rules')],['flags',t('旗標對照','Flag reference')],['downloads',t('時間與下載','Time and downloads')]].map(([id,label])=>`<a href="#${id}">${label}</a>`).join('')}</nav>
<section id="modes"><h2>${t('1. 三種查詢模式','1. Three query modes')}</h2>${table([
  ['原始值 / raw','直接查詢原始量測，不新增清理或校正欄位。','Queries raw measurements without adding cleaning or calibration fields.'],
  ['原始值＋即時計算係數 / both','只套用係數，新增 *_calibrated、*_calibration_status、版本與記錄 ID；支援原始數值及十進位數字字串，原始內容保留。不執行六項清理規則，不產生 *_final；此模式保留負校正結果。','Applies coefficients only; adds *_calibrated, *_calibration_status and coefficient IDs. Accepts numbers and decimal numeric strings while preserving raw input. Does not apply the six cleaning rules or produce *_final. Negative calibrated results are retained in this mode.'],
  ['已完成清理與校正 / processed','讀取背景已完成的六項規則成果，含原始值、*_clean、*_calibrated、*_final 與品質資訊。未完成期間會列出缺漏，不用原始值補齊。','Reads completed background six-rule results, including raw, *_clean, *_calibrated, *_final and quality fields. Missing periods are reported rather than filled with raw values.'],
])}</section>
<section id="raw"><h2>${t('2. 原始量測欄位','2. Raw measurement fields')}</h2><p>${t('除明確說明的處理欄位外，各欄位沿用設備原始單位與格式；勿僅由欄名推定電壓、速度、濃度或座標的單位與編碼。','Unless specified as a processing field, values retain the device units and format. Do not infer voltage, speed, concentration or coordinate units/encoding solely from a column name.')}</p>${table(raw)}</section>
<section id="stages"><h2>${t('3. 清理、校正與最終值','3. Cleaned, calibrated and final values')}</h2><p>${t('下列 * 代表完整 PM 通道名稱，例如 PM1_G3、PM2.5_G3 或 PM10_GSA。G3 與 GSA 分開處理；沒有適用係數的通道仍可有清理值，但沒有校正值或最終值。','Here * represents a full PM channel name, such as PM1_G3, PM2.5_G3 or PM10_GSA. G3 and GSA are processed separately. A channel without an applicable coefficient may have a cleaned value but no calibrated or final value.')}</p>${table(stages)}
<h3>${t('閱讀範例','Reading example')}</h3><pre>PM1_G3 = 12
PM1_G3_clean = 12
PM1_G3_calibrated = 18
PM1_G3_final = 15</pre><p>${t('假設同組 PM2.5 校正值為 15，且其他排除規則未觸發，PM1 最終值會調整為 15；原始值 12 及校正值 18 都保留。','If the corresponding calibrated PM2.5 is 15 and no other exclusion applies, final PM1 is capped to 15. Raw 12 and calibrated 18 remain available.')}</p></section>
<section id="meta"><h2>${t('4. 版本、工作與品質欄位','4. Version, job and quality fields')}</h2>${table(meta)}<p>${t('品質摘要中的次數是各欄位旗標累計，不能相加當成刪除列數。S3 已驗證只表示成果物件完成儲存與完整性驗證，不保證每個校正值有效。','Quality summary counts aggregate flags across fields; their sum is not a deleted-row count. S3 verified means storage and integrity checks succeeded, not that every calibrated value is valid.')}</p></section>
<section id="rules"><h2>${t('5. 六項處理規則','5. Six processing rules')}</h2><ol>${rules.map(rule=>`<li>${escape(rule[en?1:0])}</li>`).join('')}</ol><p>${t('清理以排除衍生欄位數值表示，不刪除原始量測列。PM125 與 UNMAPPED 通道只供係數查詢，不套用到上述 PM 計算；Factor_* 欄位不參與計算。','Cleaning excludes derived values without deleting original measurement rows. PM125 and UNMAPPED coefficient channels are lookup-only. Factor_* columns are not used in calculation.')}</p></section>
<section id="flags"><h2>${t('6. 完整六項規則的品質旗標','6. Six-rule quality flags')}</h2>${table(flags)}<h3>${t('單純係數模式的 *_calibration_status','Coefficient-only *_calibration_status')}</h3>${table(coefficientFlags)}</section>
<section id="downloads"><h2>${t('7. 時間、檔名與歷史成果','7. Time, filenames and historical results')}</h2><ul>
<li>${t('匯出 timestamp 使用 UTC。例如 2026-09-30T16:00:00.000Z，臺灣時間為 2026/10/01 00:00:00。查詢表單依畫面選定時區輸入。','Exported timestamps use UTC. For example, 2026-09-30T16:00:00.000Z is 2026-10-01 00:00:00 in Taiwan. Enter query times in the timezone selected in the app.')}</li>
<li>${t('背景每日工作採 [開始,結束)，不含結束時刻；資料查詢包含結束時間。查詢終點若剛好為次日零時，也會涵蓋該時刻，可能需要次日的成果。','Daily jobs use [start,end), excluding the end instant; data queries include the end instant. A query ending exactly at next-day midnight also includes that instant and may require the next day’s result.')}</li>
<li>${t('下載檔名依臺灣日期，例如 AL-1143_20261001.zip；跨日為 AL-1143_20261001_20261031.zip。ZIP 內有 CSV 或 JSON，UTF-8 CSV 含 BOM，可用支援 UTF-8 的試算表工具開啟。','Download names use Taiwan dates, such as AL-1143_20261001.zip or AL-1143_20261001_20261031.zip. ZIP contains CSV or JSON; CSV uses UTF-8 with BOM.')}</li>
<li>${t('一台設備的所選期間可合併成一份資料檔；批量下載放在同一個 ZIP，不需要逐日下載。同設備多個授權區段以 segment-編號區別。','A selected period for one device can be merged into one data file. Batch downloads share one ZIP; daily downloads are not required. Multiple authorized segments for the same device retain segment IDs to avoid filename collisions.')}</li>
<li>${t('rawSchema=all-fields-1 的新工作保留完整原始欄位；舊成果未儲存的欄位不會自動補上。需完整欄位或修正版結果時，請管理員「重新計算新版本」。混合新舊成果匯出時，舊檔缺少的欄位留空。','New jobs with rawSchema=all-fields-1 retain full raw fields. Old results are not backfilled automatically. Ask an administrator to queue a new revision for full fields or corrected processing. When schemas are mixed, unavailable old-file fields are blank.')}</li>
<li>${t('自動排程處理最近三個完整日；較早尚未校正的資料需管理員手動建立工作。下載前可先檢查品質摘要與版本。','Automatic scheduling processes the last three completed days. Older unprocessed data requires a manually queued job. Inspect quality and versions before analysis.')}</li>
</ul></section>
<footer class="muted">${t('文件對應系統目前提供的欄位與處理規則。不同設備可能沒有所有通道；請依實際資料與係數版本判讀。','This guide describes the current fields and processing rules. Devices may not provide every channel; interpret values against actual data and coefficient versions.')}</footer>
</main></body></html>\n`;
}
export async function writeFieldGuides({check=false}={}){
  const directory=fileURLToPath(new URL('../public/docs/',import.meta.url));if(!check)await mkdir(directory,{recursive:true});
  for(const language of ['ZH','EN']){
    const path=resolve(directory,`ASLUNG_Data_Fields_${language}.html`),content=fieldGuideHtml(language);
    if(check){if(await readFile(path,'utf8')!==content)throw new Error('欄位說明文件需重新產生：'+path);}
    else await writeFile(path,content,'utf8');
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await writeFieldGuides({check:process.argv.includes('--check')});
