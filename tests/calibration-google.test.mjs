import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createVerify} from 'node:crypto';
import {fetchCalibrationCsv} from '../lib/calibration-google.mjs';

test('public CSV uses only the validated Google source and rejects login pages during parsing',async()=>{
  const fetch=globalThis.fetch,credentials=process.env.GOOGLE_CALIBRATION_CREDENTIALS,json=process.env.GOOGLE_CALIBRATION_CREDENTIALS_JSON;
  delete process.env.GOOGLE_CALIBRATION_CREDENTIALS;delete process.env.GOOGLE_CALIBRATION_CREDENTIALS_JSON;
  try{
    let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'https://docs.google.com/spreadsheets/d/test/edit'.replace('/edit','/export?format=csv&gid=3'));assert.equal(options.cache,'no-store');return new Response('aslung_id,PM\nAL-0001,PM1');};
    assert.match(await fetchCalibrationCsv({url:'https://docs.google.com/spreadsheets/d/test/edit?gid=3'}),/^aslung_id/);assert.equal(calls,1);
    await assert.rejects(()=>fetchCalibrationCsv({url:'https://example.test/secret'}));assert.equal(calls,1);
    globalThis.fetch=async()=>new Response('private',{status:403});await assert.rejects(()=>fetchCalibrationCsv({url:'https://docs.google.com/spreadsheets/d/test/edit?gid=3'}),/HTTP 403/);
  }finally{globalThis.fetch=fetch;if(credentials===undefined)delete process.env.GOOGLE_CALIBRATION_CREDENTIALS;else process.env.GOOGLE_CALIBRATION_CREDENTIALS=credentials;if(json===undefined)delete process.env.GOOGLE_CALIBRATION_CREDENTIALS_JSON;else process.env.GOOGLE_CALIBRATION_CREDENTIALS_JSON=json;}
});
test('service account signs a readonly Google JWT and resolves exact gid to tab before reading formatted values',async()=>{
  const fetch=globalThis.fetch,previous=process.env.GOOGLE_CALIBRATION_CREDENTIALS_JSON;
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  process.env.GOOGLE_CALIBRATION_CREDENTIALS_JSON=JSON.stringify({client_email:'fixture@service.test',private_key:privateKey.export({type:'pkcs8',format:'pem'})});
  try{
    let calls=0;globalThis.fetch=async(url,options)=>{
      calls++;
      if(calls===1){
        assert.equal(url,'https://oauth2.googleapis.com/token');const assertion=options.body.get('assertion');
        const [head,body,sig]=assertion.split('.'),claims=JSON.parse(Buffer.from(body,'base64url'));
        assert.equal(claims.scope,'https://www.googleapis.com/auth/spreadsheets.readonly');assert.equal(claims.iss,'fixture@service.test');assert.equal(claims.exp-claims.iat,3600);
        assert.ok(createVerify('RSA-SHA256').update(head+'.'+body).verify(publicKey,sig,'base64url'));
        return Response.json({access_token:'fixture-token'});
      }
      assert.equal(options.headers.Authorization,'Bearer fixture-token');
      if(calls===2)return Response.json({sheets:[{properties:{sheetId:3,title:'Partner\'s Sheet',gridProperties:{rowCount:100,columnCount:26}}}]});
      assert.match(decodeURIComponent(url),/'Partner''s Sheet'!A1:CV100/);
      return Response.json({values:[['aslung_id','PM','Start_date'],['AL-0001','PM1','2024/1/1']]});
    };
    const content=await fetchCalibrationCsv({url:'https://docs.google.com/spreadsheets/d/test/edit?gid=3'});assert.match(content,/"AL-0001","PM1","2024\/1\/1"/);assert.equal(calls,3);
  }finally{globalThis.fetch=fetch;if(previous===undefined)delete process.env.GOOGLE_CALIBRATION_CREDENTIALS_JSON;else process.env.GOOGLE_CALIBRATION_CREDENTIALS_JSON=previous;}
});
