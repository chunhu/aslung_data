// An actual read/write probe. Never imports store.mjs or changes the SQLite DB.
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {gzipSync,gunzipSync} from 'node:zlib';
import {storageConfiguration,fileDigest,uploadResultFile,getResultObject} from '../lib/s3-storage.mjs';

let directory;
try{
  const configuration=storageConfiguration();
  if(configuration.mode==='local')console.log('S3 未啟用，沿用本機校正成果儲存。');
  else{
    directory=await mkdtemp(join(tmpdir(),'aslung-s3-check-'));
    const path=join(directory,'probe.jsonl.gz'),content='ASLUNG S3 read-write verification\n';
    await writeFile(path,gzipSync(content),{mode:0o600});const digest=await fileDigest(path);
    const key='processed/_checks/'+randomUUID()+'.jsonl.gz';
    await uploadResultFile({...configuration,path,key,...digest});
    const response=await getResultObject({result_bucket:configuration.bucket,result_region:configuration.region,result_key:key});
    const downloaded=gunzipSync(await response.Body.transformToByteArray()).toString('utf8');
    if(downloaded!==content)throw new Error('驗證內容不符');
    console.log('S3 上傳、檢查碼與讀取驗證通過：'+configuration.bucket+'/'+key);
    console.log('驗證用小檔保留於 processed/_checks/；不會讀寫量測或會員資料。');
  }
}catch(e){console.error('S3 驗證失敗：'+e.name+(e.$metadata?.httpStatusCode?' HTTP '+e.$metadata.httpStatusCode:'')+'. 請檢查區域、儲存貯體、IAM Role、IMDSv2 及網路設定。');process.exitCode=1;}
finally{if(directory)await rm(directory,{recursive:true,force:true});}
