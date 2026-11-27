import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import loans from '../api/loans.js';
import upi from '../server_routes/upi_payments.js';
import { createAdminSession } from '../server_shared.js';

process.env.ADMIN_SESSION_SECRET='fixture-secret';
process.env.SUPABASE_URL='https://fixture.invalid';
process.env.SUPABASE_SERVICE_KEY='fixture';
const owner='ef6ed8d8-7e2b-47c0-942d-5965e9ae8ccd';
const folder=createHash('sha256').update('public-folder:'+owner).digest('hex');
async function call(handler,method,action,body,headers={}) {
    const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(data){this.data=data;}};
    await handler({method,query:{action},body,headers},res);
    return res;
}

test('directory is public, verified details are scoped, and private access is separate from admin login',async t=>{
    const reads=[];
    t.mock.method(globalThis,'fetch',async(url,opts)=>{
        const u=new URL(url);
        if(u.pathname.endsWith('abhi_public_directory'))return Response.json({folders:[],months:[]});
        if(u.pathname.endsWith('abhi_unlock_borrower')){
            const body=JSON.parse(opts.body);
            assert.equal(body.p_key,folder);
            if(body.p_phone==='9000000002')return Response.json({allowed:false,retry_after_seconds:100});
            return Response.json(body.p_phone==='9000000001'?{borrower_id:owner}:{allowed:true});
        }
        reads.push(u);
        return Response.json([{id:'test-loan',borrowers:{name:'Demo'},emis:[]}]);
    });
    assert.deepEqual((await call(loans,'GET',undefined)).data,{folders:[],months:[]});
    assert.equal((await call(loans,'GET','account')).code,401);
    assert.equal((await call(loans,'POST','unlock',{folder,phone:'9000000000'})).code,403);
    const limited=await call(loans,'POST','unlock',{folder,phone:'9000000002'});
    assert.equal(limited.code,429);
    assert.equal(limited.headers['Retry-After'],'100');
    assert.equal(reads.length,0);
    const ok=await call(loans,'POST','unlock',{folder,phone:'+91 90000 00001'});
    assert.equal(ok.code,200);
    assert.equal(ok.data.loans[0].folder_key,folder);
    const headers={authorization:'Bearer '+ok.data.token};
    assert.equal((await call(loans,'GET','account',null,headers)).code,200);
    assert.equal((await call(loans,'GET','account',null,{authorization:'Bearer '+createAdminSession()})).code,401);
    const edited=ok.data.token.replace(owner,'00000000-0000-4000-8000-000000000000');
    assert.equal((await call(loans,'GET','account',null,{authorization:'Bearer '+edited})).code,401);
    assert.ok(reads.every(u=>u.searchParams.get('borrower_id')==='eq.'+owner && !u.searchParams.get('select').includes('phone')));
    t.mock.method(Date,'now',()=>ok.data.expires+1);
    assert.equal((await call(loans,'GET','account',null,headers)).code,401);
});

test('public UPI reads and writes require an account session',async t=>{
    t.mock.method(globalThis,'fetch',()=>{throw Error('Unexpected database call');});
    for(const [action,method] of [['active','GET'],['status','GET'],['start','POST'],['reference','POST'],['cancel','POST']]){
        assert.equal((await call(upi,method,action,{})).code,401);
    }
});
