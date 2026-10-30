import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFleetSchedule as config,nextFleetSchedule as next,fleetScheduleLabel as label} from '../lib/fleet-schedule.mjs';
test('fixed intervals remain compatible with existing sources',()=>{
 const c=config({intervalMins:120});assert.equal(c.type,'interval');assert.equal(next(c,new Date('2026-10-30T00:00:00Z')),'2026-10-30T02:00:00.000Z');assert.equal(label(c),'每 120 分鐘');
});
test('daily Taipei times cross UTC dates and never repeat the current scheduled instant',()=>{
 const c=config({scheduleType:'daily',scheduleTime:'05:00'});
 assert.equal(next(c,new Date('2026-10-30T20:59:00Z')),'2026-10-30T21:00:00.000Z');
 assert.equal(next(c,new Date('2026-10-30T21:00:00Z')),'2026-10-31T21:00:00.000Z');
 assert.equal(next(c,new Date('2026-12-31T22:00:00Z')),'2027-01-01T21:00:00.000Z');
 assert.match(label(c),/每天 05:00/);
});
test('weekly schedules honor selected weekdays, Sunday midnight and seven-day wrap',()=>{
 const c=config({scheduleType:'weekly',scheduleTime:'05:00',scheduleDays:'3,1,1'});assert.equal(c.days,'1,3');
 assert.equal(next(c,new Date('2026-10-30T00:00:00Z')),'2026-11-01T21:00:00.000Z');
 const sunday=config({scheduleType:'weekly',scheduleTime:'00:00',scheduleDays:'0'});
 assert.equal(next(sunday,new Date('2026-10-31T15:59:00Z')),'2026-10-31T16:00:00.000Z');
 assert.equal(next(sunday,new Date('2026-10-31T16:00:00Z')),'2026-11-07T16:00:00.000Z');
 assert.match(label(c),/每週一、三/);
});
test('invalid active schedule inputs are rejected, inactive controls do not block another mode',()=>{
 for(const p of [{scheduleType:'other'},{scheduleType:'weekly',scheduleDays:''},{scheduleType:'weekly',scheduleDays:'7'},{scheduleType:'daily',scheduleTime:'24:00'},{intervalMins:0},{intervalMins:1.5}])assert.throws(()=>config(p));
 assert.equal(config({scheduleType:'daily',scheduleTime:'05:00',scheduleDays:'',intervalMins:''}).type,'daily');
});
