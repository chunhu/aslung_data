import {GetBucketVersioningCommand,ListObjectVersionsCommand,DeleteObjectsCommand} from '@aws-sdk/client-s3';
import {s3Client} from './s3-storage.mjs';

export function validateCleanupScope(scope){
  if(!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(scope.bucket)||!/^\w{2}(?:-\w+)+-\d$/.test(scope.region)||
    !/^processed\/[A-Za-z0-9_-]{1,80}\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]{36}\/$/.test(scope.prefix))throw new Error('S3 清除路徑不正確。');
}
export async function cleanupObjectVersions(scope,client=s3Client(scope.region),heartbeat=()=>{}){
  validateCleanupScope(scope);heartbeat();
  const configuration=await client.send(new GetBucketVersioningCommand({Bucket:scope.bucket}));
  const versioned=['Enabled','Suspended'].includes(configuration.Status),objects=[];
  let KeyMarker,VersionIdMarker;
  for(let page=0;page<100;page++){
    heartbeat();const result=await client.send(new ListObjectVersionsCommand({Bucket:scope.bucket,Prefix:scope.prefix,KeyMarker,VersionIdMarker,MaxKeys:1000}));
    for(const item of [...(result.Versions||[]),...(result.DeleteMarkers||[])]){
      if(!item.Key?.startsWith(scope.prefix)||!/^[a-f0-9]{64}\.jsonl\.gz$/.test(item.Key.slice(scope.prefix.length)))throw new Error('S3 回傳非預期物件，停止清除。');
      if(versioned&&typeof item.VersionId!=='string')throw new Error('S3 物件版本缺失。');
      objects.push({Key:item.Key,...(versioned?{VersionId:item.VersionId}:{}),bytes:Number(item.Size||0)});
    }
    if(!result.IsTruncated)return objects;
    if(!result.NextKeyMarker||(result.NextKeyMarker===KeyMarker&&result.NextVersionIdMarker===VersionIdMarker))throw new Error('S3 分頁未前進。');
    KeyMarker=result.NextKeyMarker;VersionIdMarker=result.NextVersionIdMarker;
  }
  throw new Error('單工作 S3 版本超過清除上限。');
}
export async function purgeCleanupScope(scope,heartbeat=()=>{},client=s3Client(scope.region)){
  const objects=await cleanupObjectVersions(scope,client,heartbeat);
  for(let offset=0;offset<objects.length;offset+=1000){
    heartbeat();const result=await client.send(new DeleteObjectsCommand({Bucket:scope.bucket,Delete:{Quiet:true,Objects:objects.slice(offset,offset+1000).map(({bytes,...object})=>object)}}));
    if(result.Errors?.length)throw new Error('S3 刪除未全部成功：'+result.Errors.map(e=>e.Code||'Unknown').slice(0,5).join(', '));
  }
  if((await cleanupObjectVersions(scope,client,heartbeat)).length)throw new Error('S3 仍有成果版本，保留工作供重試。');
  return objects.length;
}
