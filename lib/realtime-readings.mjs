// Share only raw measurements. Callers must authorize IDs on every request.
const registry=Symbol.for('aslung.realtime.readers');
export function createRealtimeReader({ttlMs=120000,maxEntries=5000,batchSize=50,concurrency=2,now=Date.now,onError=()=>{}}={}){
  const cache=new Map(),pending=new Map(),queue=[];let running=0;
  const columns='time, uid AS aslung_id, ch1 AS PM1_G3, ch2 AS `PM2.5_G3`, ch3 AS PM10_G3, ch4 AS temperature, ch5 AS rh, ch6 AS co2, ch7 AS battery, ch29 AS PM1_GSA, ch30 AS `PM2.5_GSA`, ch31 AS PM10_GSA';
  function pump(pool){
    while(running<concurrency&&queue.length){
      const jobs=queue.shift();running++;
      const sql=jobs.map(()=>`(SELECT ? AS _realtime_id, ${columns} FROM rawdata WHERE uid = ? ORDER BY time DESC, id DESC LIMIT 1)`).join(' UNION ALL ');
      void (async()=>{
        try{
          const [rows]=await pool.query({sql,values:jobs.flatMap(job=>[job.id,job.id]),timeout:10000});
          const byId=new Map(rows.map(row=>[String(row._realtime_id??row.aslung_id),row]));
          const storedAt=now();
          for(const job of jobs){
            const row=byId.get(job.id)||null;
            cache.delete(job.id);cache.set(job.id,{row,storedAt});
            while(cache.size>maxEntries)cache.delete(cache.keys().next().value);
            job.resolve(row);
          }
        }catch(e){onError(e);for(const job of jobs)job.resolve(null);}
        finally{for(const job of jobs)pending.delete(job.id);running--;pump(pool);}
      })();
    }
  }
  return async function read(pool,ids,{refresh=false,ttlMs:currentTtlMs=ttlMs}={}){
    const promises=[],jobs=[],time=now();
    for(const id of new Set(ids)){
      const cached=cache.get(id);
      if(!refresh&&cached&&cached.storedAt+currentTtlMs>time){
        cache.delete(id);cache.set(id,cached);promises.push(Promise.resolve(cached.row));continue;
      }
      cache.delete(id);
      if(pending.has(id)){promises.push(pending.get(id));continue;}
      let resolve;const promise=new Promise(done=>{resolve=done;});
      pending.set(id,promise);jobs.push({id,resolve});promises.push(promise);
    }
    for(let i=0;i<jobs.length;i+=batchSize)queue.push(jobs.slice(i,i+batchSize));
    pump(pool);return (await Promise.all(promises)).filter(Boolean);
  };
}
export function latestRealtimeReadings(pool,ids,options){
  const readers=globalThis[registry]??=new WeakMap();
  if(!readers.has(pool))readers.set(pool,createRealtimeReader({onError:e=>console.error('Failed to fetch realtime batch',e?.code||'query failed')}));
  return readers.get(pool)(pool,ids,options);
}
