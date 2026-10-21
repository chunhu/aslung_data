import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportName} from '../lib/export-name.mjs';

test('daily filenames use Taiwan dates and exclude the next midnight for daily jobs',()=>{
  assert.equal(exportName('AL-1143','2026-09-30T16:00:00Z','2026-10-01T16:00:00Z',{endExclusive:true}),'AL-1143_20261001');
  assert.equal(exportName('AL-1143','2026-09-30T16:00:00Z','2026-10-31T15:59:59Z'),'AL-1143_20261001_20261031');
  assert.equal(exportName('AL-1143','2026-09-30T16:00:00Z','2026-10-01T16:00:00Z'),'AL-1143_20261001_20261002');
});
test('batch names distinguish deployment segments and sanitize unsafe characters',()=>{
  assert.equal(exportName('AL-1143','2026-10-01T00:00:00Z','2026-10-01T01:00:00Z',{segmentId:'431'}),'AL-1143_20261001_segment-431');
  assert.doesNotMatch(exportName('../device','2026-10-01','2026-10-02'),/[./\\]/);
  assert.throws(()=>exportName('AL-1','invalid','2026-10-02'));
});
