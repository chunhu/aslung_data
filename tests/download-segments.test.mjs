import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildDownloadSegments, intersectRanges, fetchRangesPage, rangeTime} from '../lib/download-segments.mjs';

const member = {role:'member',email:'member@example.test',name:'Member'};
const devices = [{id:'AL-0609'}, {id:'AL-0610'}];
const locations = [
  {id:1,aslung_id:'AL-0609',lab_id:'N0059',start_time:'2026-01-01T00:00:00Z',end_time:'2026-01-10T00:00:00Z'},
  {id:2,aslung_id:'AL-0609',lab_id:'N0059',start_time:'2026-02-01T00:00:00Z',end_time:null,active:1},
  {id:3,aslung_id:'AL-0609',lab_id:'N0060',start_time:'2025-01-01T00:00:00Z',end_time:'2025-02-01T00:00:00Z'},
  {id:4,aslung_id:'AL-0610',lab_id:'',start_time:'2026-03-01T00:00:00Z',end_time:null,active:1}
];
const grant = (start,end) => ({email:member.email,grant_type:'lab',lab_id:'N0059',start,end});

test('admin sees every segment, including repeated deployments, ordered by lab and descending start', () => {
  const segments = buildDownloadSegments({...member,role:'admin'},devices,locations,[]);
  assert.deepEqual(segments.map(s => s.segment_id), ['2','1','3','4']);
  assert.equal(new Set(segments.map(s => s.id)).size, 2);
  assert.equal(segments[0].is_active_at_lab,true);
  assert.equal(segments[1].is_active_at_lab,false);
});

test('member sees only intersections of matching grant and deployment, retaining disconnected ranges', () => {
  const segments = buildDownloadSegments(member,devices,locations,[
    grant('2026-01-02T00:00:00Z','2026-01-03T00:00:00Z'),
    grant('2026-01-05T00:00:00Z','2026-01-06T00:00:00Z')
  ]);
  assert.deepEqual(segments.map(s=>s.segment_id),['1']);
  assert.equal(segments[0].tracking_ranges.length,2);
  assert.equal(intersectRanges(segments[0].tracking_ranges,'2026-01-01T00:00:00Z','2026-01-10T00:00:00Z').length,2);
});

test('maintenance access applies to the maintained segment rather than all device history', () => {
  const segments = buildDownloadSegments(member,devices,locations.map(l=>({...l,maintainer:l.id===3?'Member':''})),[]);
  assert.deepEqual(segments.map(s=>s.segment_id),['3']);
});

test('pagination walks all authorized intervals and never fetches the gap', async () => {
  const ranges = [{start:'2026-01-02T00:00:00Z',end:'2026-01-03T00:00:00Z'},
    {start:'2026-01-05T00:00:00Z',end:'2026-01-06T00:00:00Z'}];
  const calls=[];
  const fetcher=async (start,end,cursor,limit)=>{
    calls.push({start,end,cursor,limit});
    return {data:[start],has_more:false,next_cursor:null};
  };
  const first=await fetchRangesPage(ranges,'',1,fetcher);
  assert.equal(first.has_more,true);
  const second=await fetchRangesPage(ranges,first.next_cursor,1,fetcher);
  assert.equal(second.has_more,false);
  assert.deepEqual([...first.data,...second.data],ranges.map(r=>r.start));
  assert.deepEqual(calls.map(c=>[c.start,c.end]),ranges.map(r=>[r.start,r.end]));
  await assert.rejects(fetchRangesPage(ranges,Buffer.from(JSON.stringify({range:100,cursor:''})).toString('base64url'),1,fetcher));
});

test('local deployment dates use Taiwan time and overlapping grants do not duplicate rows', () => {
  assert.equal(rangeTime('2026-01-01 08:00:00'),Date.parse('2026-01-01T00:00:00Z'));
  assert.deepEqual(intersectRanges([
    {start:'2026-01-01T00:00:00Z',end:'2026-01-05T00:00:00Z'},
    {start:'2026-01-03T00:00:00Z',end:'2026-01-06T00:00:00Z'}
  ],'2026-01-02T00:00:00Z','2026-01-10T00:00:00Z'),[
    {start:'2026-01-02T00:00:00.000Z',end:'2026-01-06T00:00:00.000Z'}
  ]);
});

 test('invalid deployment remains visible to admins but cannot produce downloadable ranges', () => {
  const bad = {...locations[0],id:99,start_time:'2026-01-10T00:00:01Z',end_time:'2026-01-10T00:00:00Z'};
  const adminSegments = buildDownloadSegments({...member,role:'admin'},devices,[bad],[]);
  assert.equal(adminSegments.length,1);
  assert.equal(adminSegments[0].invalid_range,true);
  assert.deepEqual(adminSegments[0].tracking_ranges,[]);
  assert.deepEqual(buildDownloadSegments(member,devices,[bad],[grant('2026-01-01T00:00:00Z',null)]),[]);
 });
