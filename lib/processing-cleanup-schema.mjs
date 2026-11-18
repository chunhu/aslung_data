// Independent of application migrations so both processing and upload claims can
// respect durable cleanup reservations before any cleanup API has been visited.
export function ensureCleanupBatchSchema(d){
 d.exec(`CREATE TABLE IF NOT EXISTS processing_cleanup_batches(
 plan_id TEXT PRIMARY KEY,state TEXT NOT NULL DEFAULT 'PREVIEW',total INTEGER NOT NULL DEFAULT 0,batch_size INTEGER NOT NULL DEFAULT 500 CHECK(batch_size BETWEEN 1 AND 500),next_ordinal INTEGER NOT NULL DEFAULT 0,current_batch INTEGER NOT NULL DEFAULT 0,cancel_requested INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '',owner TEXT,lease_until INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,finished_at TEXT);
 CREATE TABLE IF NOT EXISTS processing_cleanup_batch_items(
 plan_id TEXT NOT NULL,ordinal INTEGER NOT NULL,job_id TEXT NOT NULL,snapshot TEXT NOT NULL,fingerprint TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'PREVIEW',PRIMARY KEY(plan_id,ordinal));
 CREATE INDEX IF NOT EXISTS cleanup_batch_progress ON processing_cleanup_batch_items(plan_id,state,ordinal);
 CREATE UNIQUE INDEX IF NOT EXISTS cleanup_job_reservation ON processing_cleanup_batch_items(job_id) WHERE state IN ('WAITING','ACTIVE');
 CREATE TABLE IF NOT EXISTS processing_cleanup_batch_events(id INTEGER PRIMARY KEY,plan_id TEXT NOT NULL,action TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL);`);
}
