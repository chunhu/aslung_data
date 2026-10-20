import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {S3Client,PutObjectCommand,HeadObjectCommand,GetObjectCommand} from '@aws-sdk/client-s3';

const clients=new Map();
export function storageConfiguration(env=process.env){
  const mode=env.CALIBRATION_STORAGE||'local';
  if(!['local','s3'].includes(mode))throw new Error('CALIBRATION_STORAGE 只支援 local 或 s3。');
  if(mode==='local')return {mode};
  const bucket=env.S3_BUCKET||'',region=env.AWS_REGION||'';
  if(!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)||!/^\w{2}(?:-\w+)+-\d$/.test(region))throw new Error('啟用 S3 需設定有效的 S3_BUCKET 與 AWS_REGION。');
  return {mode,bucket,region};
}
export function s3Client(region){
  if(!clients.has(region))clients.set(region,new S3Client({region,maxAttempts:3,requestHandler:{connectionTimeout:5000,requestTimeout:120000}}));
  return clients.get(region);
}
export async function fileDigest(path){
  const hash=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream(path)){hash.update(chunk);bytes+=chunk.length;}
  return {sha256:hash.digest('hex'),bytes};
}
export async function uploadResultFile({path,bucket,region,key,sha256,bytes},client=s3Client(region)){
  if(bytes>5*1024**3)throw new Error('單份校正成果超過 5 GiB，目前需縮短工作區間。');
  if((await stat(path)).size!==bytes)throw new Error('本機成果大小已變更，停止上傳。');
  const body=createReadStream(path);
  try{
    await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:body,ContentLength:bytes,
      ContentType:'application/gzip',ServerSideEncryption:'AES256',
      ChecksumSHA256:Buffer.from(sha256,'hex').toString('base64'),Metadata:{sha256}}));
  }finally{body.destroy();}
  const head=await client.send(new HeadObjectCommand({Bucket:bucket,Key:key,ChecksumMode:'ENABLED'}));
  if(head.ContentLength!==bytes||head.ChecksumSHA256!==Buffer.from(sha256,'hex').toString('base64')||head.Metadata?.sha256!==sha256)
    throw new Error('S3 成果大小或檢查碼驗證失敗，保留本機檔案。');
}
export async function getResultObject(job,client=s3Client(job.result_region)){
  return client.send(new GetObjectCommand({Bucket:job.result_bucket,Key:job.result_key}));
}
