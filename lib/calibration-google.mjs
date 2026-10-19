import {createSign} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {CalibrationError,googleCalibrationUrl} from './calibration.mjs';

export function calibrationAuthentication(){return process.env.GOOGLE_CALIBRATION_CREDENTIALS||process.env.GOOGLE_CALIBRATION_CREDENTIALS_JSON?'service_account':'public_csv';}
async function boundedText(res){
  if(!res.ok)throw new CalibrationError(`無法讀取 Google 試算表（HTTP ${res.status}）。請確認分享給服務帳號，或允許伺服器讀取 CSV。`);
  const reader=res.body?.getReader();if(!reader)throw new CalibrationError('Google 未回傳內容。');
  const decoder=new TextDecoder();let size=0,text='';
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>12000000)throw new CalibrationError('Google 回應超過 12 MB。');text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}
  finally{await reader.cancel();}
}
async function json(url,options={}){return JSON.parse(await boundedText(await fetch(url,{...options,signal:AbortSignal.timeout(30000),cache:'no-store'})));}
async function serviceToken(){
  let credentials;
  try{credentials=JSON.parse(process.env.GOOGLE_CALIBRATION_CREDENTIALS_JSON||await readFile(process.env.GOOGLE_CALIBRATION_CREDENTIALS,'utf8'));}
  catch{throw new CalibrationError('Google 服務帳號設定無法讀取，請檢查伺服器環境設定。');}
  if(!credentials.client_email||!credentials.private_key)throw new CalibrationError('Google 服務帳號缺少必要憑證。');
  const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url'),now=Math.floor(Date.now()/1000);
  const head=encode({alg:'RS256',typ:'JWT'}),payload=encode({iss:credentials.client_email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
  const unsigned=head+'.'+payload;
  let signature;try{signature=createSign('RSA-SHA256').update(unsigned).sign(credentials.private_key,'base64url');}catch{throw new CalibrationError('Google 服務帳號金鑰無法使用。');}
  const response=await json('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+signature})});
  if(!response.access_token)throw new CalibrationError('Google 授權失敗。');
  return response.access_token;
}
export async function fetchCalibrationCsv(source){
  const {id,gid}=googleCalibrationUrl(source.url);
  if(calibrationAuthentication()==='public_csv')return boundedText(await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`,{signal:AbortSignal.timeout(30000),cache:'no-store'}));
  const token=await serviceToken(),options={headers:{Authorization:'Bearer '+token}};
  const metadata=await json(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties`,options);
  const sheet=metadata.sheets?.find(s=>String(s.properties.sheetId)===gid)?.properties;
  if(!sheet)throw new CalibrationError('找不到網址指定的分頁。');
  if(sheet.gridProperties?.columnCount>100)throw new CalibrationError('校正分頁欄位超過 100 欄，請移至專用分頁。');
  const rowCount=Math.min(sheet.gridProperties?.rowCount||50002,50002);
  const range=`'${sheet.title.replaceAll("'","''")}'!A1:CV${rowCount}`;
  const data=await json(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`,options);
  return (data.values||[]).map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n');
}
