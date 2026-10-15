import {test} from 'node:test';
import assert from 'node:assert/strict';
import {currentDeploymentMap} from '../lib/device-deployments.mjs';
import {buildFleetRows} from '../lib/fleet.mjs';
import {visibleRealtimeRows} from '../lib/realtime-discovery.mjs';

const now = Date.parse('2026-10-15T09:00:00Z');

test('AL-0502 remains online and undeployed despite its cached historical S0017 location', () => {
  const devices = [{id:'AL-0502',status:'STANDBY',location:'S0017'}];
  const locations = [{id:3799,aslung_id:'AL-0502',lab_id:'S0017',active:0,
    start_time:'2025-08-06T16:00:00.000Z',end_time:'2026-08-21T15:59:59.000Z'}];
  const readings = [{aslung_id:'AL-0502',timestamp:'2026-10-15T08:58:34Z'}];
  assert.equal(currentDeploymentMap(locations,now).get('AL-0502'),undefined);
  const fleet = buildFleetRows(devices,locations,readings,[],60,now)[0];
  assert.equal(fleet.lab,'');
  assert.equal(fleet.health,'ONLINE');
  assert.equal(fleet.history[0].lab_id,'S0017');
  assert.equal(visibleRealtimeRows(readings,devices,locations,new Date(now)).length,1);
  assert.equal(devices[0].location,'S0017'); // Preserve history; correct the interpretation.
});

test('ended, inactive, invalid and future deployments cannot become current locations', () => {
  const base = {aslung_id:'AL-1',lab_id:'N1',active:1,start_time:'2026-01-01',end_time:null};
  const locations = [
    {...base,id:1,active:0},
    {...base,id:2,end_time:'2026-10-01'},
    {...base,id:3,start_time:'2026-11-01'},
    {...base,id:4,start_time:'invalid'}
  ];
  assert.equal(currentDeploymentMap(locations,now).size,0);
  assert.equal(buildFleetRows([{id:'AL-1'}],locations,[],[],60,now)[0].lab,'');
});

test('current locations use the latest valid deployment independent of input order', () => {
  const base = {aslung_id:'AL-1',active:1,end_time:null};
  const locations = [
    {...base,id:3,lab_id:'N3',start_time:'2026-09-01'},
    {...base,id:1,lab_id:'N1',start_time:'2026-01-01'},
    {...base,id:2,lab_id:'N2',start_time:'2026-09-01'},
    {...base,id:4,lab_id:'S0017',start_time:'2026-10-01',active:0}
  ];
  for (const order of [locations,[...locations].reverse()]) {
    assert.equal(currentDeploymentMap(order,now).get('AL-1').lab_id,'N3');
    assert.equal(buildFleetRows([{id:'AL-1'}],order,[],[],60,now)[0].lab,'N3');
  }
});
