const ready=new WeakSet();
export function ensureHistoricalBatchSchema(d){
 if(ready.has(d))return;
 d.exec(`CREATE TABLE IF NOT EXISTS historical_batches(
 id TEXT PRIMARY KEY,actor TEXT NOT NULL,request_key TEXT NOT NULL,configuration TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'QUEUED',current_month INTEGER NOT NULL DEFAULT 0,total_months INTEGER NOT NULL,total_units INTEGER NOT NULL,
 error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,finished_at TEXT,UNIQUE(actor,request_key));
 CREATE INDEX IF NOT EXISTS historical_batch_queue ON historical_batches(status,created_at);
 CREATE TABLE IF NOT EXISTS historical_batch_months(
 batch_id TEXT NOT NULL,position INTEGER NOT NULL,label TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,
 total INTEGER NOT NULL,generated INTEGER NOT NULL DEFAULT 0,skipped INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'PENDING',raw_rows INTEGER NOT NULL DEFAULT 0,processed_rows INTEGER NOT NULL DEFAULT 0,bytes INTEGER NOT NULL DEFAULT 0,
 skipped_examples TEXT NOT NULL DEFAULT '[]',PRIMARY KEY(batch_id,position));
 CREATE TABLE IF NOT EXISTS historical_batch_jobs(
 batch_id TEXT NOT NULL,month INTEGER NOT NULL,ordinal INTEGER NOT NULL,job_id TEXT NOT NULL,owned INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(batch_id,month,ordinal));
 CREATE INDEX IF NOT EXISTS historical_job_interest ON historical_batch_jobs(job_id,batch_id);
 CREATE TABLE IF NOT EXISTS historical_batch_events(id INTEGER PRIMARY KEY,batch_id TEXT NOT NULL,action TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL);`);
 ready.add(d);
}
// A reused job may serve another active request. Pausing one batch cannot stop it.
export function historicalRunnableSql(job){return `(NOT EXISTS(SELECT 1 FROM historical_batch_jobs hb WHERE hb.job_id=${job} AND hb.owned=1)
 OR EXISTS(SELECT 1 FROM historical_batch_jobs hb JOIN historical_batches b ON b.id=hb.batch_id WHERE hb.job_id=${job} AND b.status='RUNNING'))`;}
