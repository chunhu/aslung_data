import JSZip from 'jszip';
import {Readable} from 'node:stream';

function cell(value){
  let text=value==null?'':typeof value==='object'?JSON.stringify(value):String(value);
  if(typeof value==='string'&&/^[=+\-@\t\r]/.test(text))text="'"+text;
  return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;
}
export async function* csvChunks(rows,columns){
  let keys;
  for await(const row of rows){
    if(!keys){keys=columns||Object.keys(row);yield '\uFEFF'+keys.map(cell).join(',')+'\r\n';}
    yield keys.map(k=>cell(row[k])).join(',')+'\r\n';
  }
  if(!keys)yield '\uFEFFtimestamp\r\n';
}
export async function* jsonChunks(rows,metadata={}){
  const iterator=rows[Symbol.asyncIterator]();let next=await iterator.next();
  try{
    yield JSON.stringify(metadata).slice(0,-1)+(Object.keys(metadata).length?',':'')+'"data":[';let first=true;
    while(!next.done){yield (first?'':',')+JSON.stringify(next.value);first=false;next=await iterator.next();}yield ']}';
  }finally{await iterator.return?.();}
}
export function csvZipResponse(chunks,name,options){return archiveResponse(chunks,name,'csv',options);}
export function jsonZipResponse(chunks,name,options){return archiveResponse(chunks,name,'json',options);}
async function archiveResponse(chunks,name,extension,{maxBytes=2*1024*1024*1024}={}){
  const iterator=chunks[Symbol.asyncIterator](),first=await iterator.next();
  // ZIP32 streaming: bound the CSV entry below 4 GiB, including incompressible input.
  async function* bounded(){
    let size=0,next=first;
    try{while(!next.done){
      size+=Buffer.byteLength(next.value);
      if(size>maxBytes)throw new Error('匯出資料超過 ZIP 單檔 2 GiB 上限，請縮短區間。');
      yield typeof next.value==='string'?Buffer.from(next.value,'utf8'):next.value;next=await iterator.next();
    }}finally{await iterator.return?.();}
  }
  const basename=String(name).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,120)||'aslung_export';
  const input=Readable.from(bounded()),zip=new JSZip();
  zip.file(basename+'.'+extension,input);
  const output=zip.generateNodeStream({type:'nodebuffer',streamFiles:true,compression:'DEFLATE',compressionOptions:{level:1}});
  // JSZip uses its own readable-stream implementation. Bridge errors explicitly,
  // so an interrupted source cannot be mistaken for a successful truncated ZIP.
  let finished=false;
  const body=new ReadableStream({
    start(controller){
      output.pause();
      const fail=e=>{if(finished)return;finished=true;controller.error(e);input.destroy();output.destroy();};
      input.on('error',fail);output.on('error',fail);
      output.on('data',chunk=>{if(finished)return;controller.enqueue(new Uint8Array(chunk));if(controller.desiredSize<=0)output.pause();});
      output.on('end',()=>{if(finished)return;finished=true;controller.close();input.destroy();});
      output.on('close',()=>{if(!finished)fail(new Error('ZIP 串流中斷，請重新下載。'));});
    },
    pull(){if(!finished)output.resume();},
    cancel(){finished=true;input.destroy();output.destroy();}
  });
  return new Response(body,{headers:{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="${basename}.zip"`,'Cache-Control':'no-store'}});
}
