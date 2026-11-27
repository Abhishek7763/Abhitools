import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/payments.js';
import { createAdminSession } from '../server_shared.js';

process.env.ADMIN_SESSION_SECRET = 'test-secret';
process.env.SUPABASE_URL = 'https://fixture.test';
process.env.SUPABASE_SERVICE_KEY = 'fixture';
const emi = '650697b0-ecec-4a20-a337-1a645cf05678';
const request = 'bbf24e10-246a-42f2-9b11-b16b528df98f';

async function call(method, body, query = {}, admin = true) {
    const headers = admin ? { cookie:'abhi_admin_session=' + createAdminSession() } : {};
    const res = { setHeader(){}, status(code){ this.code=code; return this; }, json(data){ this.data=data; } };
    await handler({ method, headers, body, query },res);
    return res;
}

test('new payment clients forward an unchanged retry key and old clients can still submit', async t => {
    const writes = [];
    t.mock.method(globalThis,'fetch',async (url, options) => {
        if (url.includes('/emis?')) return Response.json([{id:emi,loan_id:emi}]);
        if (url.includes('/loans?')) return Response.json([{id:emi}]);
        writes.push([url.split('/').pop(),JSON.parse(options.body)]);
        return Response.json({success:true,payment_id:emi});
    });
    const body = { emi_id:emi, amount:10, paid_date:'2026-10-01' };
    for (let retry=0;retry<2;retry++) assert.equal((await call('POST',{...body,request_id:request})).code,201);
    assert.deepEqual(writes[1],writes[0]);
    assert.equal(writes[0][0],'abhi_record_collection');
    assert.equal(writes[0][1].p_request_id,request);
    assert.equal((await call('POST',{...body,request_id:'invalid'})).code,400);
    assert.equal((await call('POST',body)).code,201);
    assert.equal(writes[2][0],'abhi_add_emi_payment');
    assert.equal(writes.length,3);
});

test('daily totals require an admin session and a valid calendar date',async t => {
    const calls = [];
    t.mock.method(globalThis,'fetch',async (url,options)=>{
        calls.push([url.split('/').pop(),JSON.parse(options.body)]);
        return Response.json({cash:40,pending_upi:10,collected:40});
    });
    const valid = {action:'daily',date:'2026-11-25'};
    assert.equal((await call('GET',null,valid,false)).code,401);
    assert.equal((await call('GET',null,{action:'daily',date:'2026-02-30'})).code,400);
    assert.deepEqual((await call('GET',null,valid)).data,{cash:40,pending_upi:10,collected:40});
    assert.deepEqual(calls,[['abhi_daily_collection',{p_day:valid.date}]]);
});
