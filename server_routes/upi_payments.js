import { noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UPI_RE = /^[A-Za-z0-9._+-]{1,80}@[A-Za-z0-9.-]{2,40}$/;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{5,79}$/;

function requestError(message, status = 400) { return Object.assign(new Error(message), { status, publicMessage: message }); }
function validUuid(value) { const text = String(value || '').trim(); return UUID_RE.test(text) ? text : null; }
function cleanDate(value) { const text=String(value||'').slice(0,10); if(!DATE_RE.test(text)) return null; const d=new Date(`${text}T00:00:00Z`); return Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==text?null:text; }
function cleanText(value,max=500){const text=String(value??'').trim().slice(0,max);return text||null;}
function positiveInt(value){const n=Number(value);return Number.isInteger(n)&&n>0?n:null;}
function paymentType(value){return String(value||'emi').trim().toLowerCase()==='foreclosure'?'foreclosure':'emi';}

function safeRpcMessage(err,fallback='Payment request failed'){
    const message=String(err?.details?.message||err?.details?.error||'').trim();
    const allowed=[
        'Loan ID required','Valid installment number required','Loan not found','Closed loan cannot accept a new payment request',
        'EMI not found','This EMI is already paid','UPI payment is not enabled yet','UPI payment request not found',
        'UPI payment request is no longer pending','UPI payment request has expired','Confirmed amount must be greater than zero',
        'Payment exceeds EMI remaining amount','Only the next unpaid EMI can be paid online','No unpaid EMI remains on this loan',
        'Another payment request is already pending. Cancel it before switching payment type',
        'Enter a valid UPI UTR or transaction reference','A submitted payment claim cannot be cancelled by the user',
        'Foreclosure amount changed; create a new payment request','Loan has no remaining balance',
        'Payment amount changed after UTR submission; admin must review this request'
    ];
    return allowed.find(item=>message.includes(item))||fallback;
}

function buildUpiUri(data){
    const requestId=String(data?.request_id||'');
    const loanCode=String(data?.loan_code||'').trim();
    const installment=Number(data?.installment_number||0);
    const type=paymentType(data?.request_type);
    const note=type==='foreclosure'?`Loan ${loanCode} Full Closure • Ref ${requestId.slice(0,8).toUpperCase()}`:`Loan ${loanCode} EMI ${installment} • Ref ${requestId.slice(0,8).toUpperCase()}`;
    const params=new URLSearchParams({pa:String(data?.upi_id||'').trim(),pn:String(data?.payee_name||'Abhishek Management').trim(),am:String(Number(data?.amount||0)),cu:'INR',tn:note});
    return `upi://pay?${params.toString()}`;
}

async function expireOldPending(){const iso=new Date().toISOString();await supabaseRequest(`upi_payment_requests?status=eq.pending&expires_at=lte.${encodeURIComponent(iso)}`,'PATCH',{status:'expired',resolved_at:iso});}
async function readConfig(){const {data}=await supabaseRequest('upi_payment_config?id=eq.primary&select=id,upi_id,payee_name,enabled,updated_at&limit=1');return data?.[0]||{id:'primary',upi_id:null,payee_name:'Abhishek Management',enabled:false,updated_at:null};}
function publicRequestShape(row){if(!row)return null;return{request_id:row.id,request_type:row.request_type||'emi',installment_number:Number(row.installment_number||0),amount:Number(row.amount||0),status:row.status,expires_at:row.expires_at,reference_submitted:Boolean(row.user_reference),user_claimed_at:row.user_claimed_at||null};}

export default async function handler(req,res){
    noStore(res);
    const action=String(req.query?.action||'').toLowerCase();
    try{
        if(req.method==='GET'&&action==='config'){
            const config=await readConfig();
            return res.status(200).json({enabled:Boolean(config.enabled&&config.upi_id),payee_name:config.payee_name||'Abhishek Management'});
        }

        if(req.method==='GET'&&action==='active'){
            const loanCode=cleanText(req.query?.loan_code,80);
            if(!loanCode)return res.status(400).json({error:'Loan ID required'});
            await expireOldPending();
            const {data}=await supabaseRequest(`upi_payment_requests?loan_code=eq.${encodeURIComponent(loanCode)}&status=eq.pending&select=id,request_type,installment_number,amount,status,expires_at,user_reference,user_claimed_at&order=created_at.desc&limit=1`);
            return res.status(200).json({request:publicRequestShape(data?.[0]||null)});
        }

        if(req.method==='POST'&&action==='start'){
            const loanCode=cleanText(req.body?.loan_code,80);
            const type=paymentType(req.body?.request_type);
            const installment=positiveInt(req.body?.installment_number);
            if(!loanCode||(type==='emi'&&!installment))return res.status(400).json({error:'Loan ID and valid EMI number required'});
            try{
                const {data}=await supabaseRequest('rpc/abhi_start_upi_payment_request','POST',{p_loan_code:loanCode,p_installment_number:installment,p_request_type:type});
                const result=Array.isArray(data)?data[0]:data;
                if(!result?.request_id||!result?.upi_id)throw requestError('UPI payment request could not be created',500);
                return res.status(201).json({success:true,request_id:result.request_id,request_type:result.request_type||type,status:'pending',loan_code:result.loan_code,installment_number:Number(result.installment_number||0),amount:Number(result.amount||0),expires_at:result.expires_at,payee_name:result.payee_name,upi_id:result.upi_id,upi_uri:buildUpiUri(result),reference_submitted:false,verification_required:true});
            }catch(err){if(err?.publicMessage)throw err;throw requestError(safeRpcMessage(err),409);}
        }

        if(req.method==='GET'&&action==='status'){
            const requestId=validUuid(req.query?.request_id);
            if(!requestId)return res.status(400).json({error:'Valid request_id required'});
            await expireOldPending();
            const {data}=await supabaseRequest(`upi_payment_requests?id=eq.${encodeURIComponent(requestId)}&select=id,request_type,installment_number,status,amount,expires_at,confirmed_at,resolved_at,user_reference,user_claimed_at&limit=1`);
            const row=data?.[0];if(!row)return res.status(404).json({error:'Payment request not found'});
            return res.status(200).json({...publicRequestShape(row),confirmed_at:row.confirmed_at||null,resolved_at:row.resolved_at||null});
        }

        if(req.method==='POST'&&action==='reference'){
            const requestId=validUuid(req.body?.request_id);const reference=String(req.body?.reference||'').trim();
            if(!requestId||!REF_RE.test(reference))return res.status(400).json({error:'Valid request ID aur UPI UTR/transaction reference required'});
            try{
                const {data}=await supabaseRequest('rpc/abhi_submit_upi_reference','POST',{p_request_id:requestId,p_reference:reference});
                const result=Array.isArray(data)?data[0]:data;return res.status(200).json(result||{success:true,reference_submitted:true});
            }catch(err){throw requestError(safeRpcMessage(err,'UTR submit nahi hua'),409);}
        }

        if(req.method==='POST'&&action==='cancel'){
            const requestId=validUuid(req.body?.request_id);if(!requestId)return res.status(400).json({error:'Valid request_id required'});
            try{
                const {data}=await supabaseRequest('rpc/abhi_cancel_upi_payment_request','POST',{p_request_id:requestId});
                return res.status(200).json(Array.isArray(data)?(data[0]||{success:true}):(data||{success:true}));
            }catch(err){throw requestError(safeRpcMessage(err,'Payment request cancel nahi hui'),409);}
        }

        if(!requireAdmin(req,res))return;

        if(req.method==='GET'&&action==='list'){
            await expireOldPending();
            const {data}=await supabaseRequest('upi_payment_requests?select=id,emi_id,loan_id,borrower_id,loan_code,installment_number,amount,request_type,status,created_at,expires_at,confirmed_at,resolved_at,payment_id,settlement_id,user_reference,user_claimed_at,admin_note,borrowers(name),emis(due_date,due_day,due_month,due_year,amount,paid_amount,status)&order=created_at.desc&limit=150');
            const rows=data||[];const pending=rows.filter(r=>r.status==='pending').length;const claimed=rows.filter(r=>r.status==='pending'&&r.user_reference).length;const started=rows.filter(r=>r.status==='pending'&&!r.user_reference).length;
            return res.status(200).json({requests:rows,pending,claimed,started});
        }

        if(req.method==='GET'&&action==='admin-config')return res.status(200).json(await readConfig());

        if(req.method==='PUT'&&action==='config'){
            const upiId=String(req.body?.upi_id||'').trim();const payeeName=cleanText(req.body?.payee_name,100)||'Abhishek Management';const enabled=req.body?.enabled===true;
            if(upiId&&(!UPI_RE.test(upiId)||upiId.length>120))return res.status(400).json({error:'Valid UPI ID enter karein, jaise name@bank'});
            if(enabled&&!upiId)return res.status(400).json({error:'Enable karne se pehle UPI ID required hai'});
            const now=new Date().toISOString();
            const {data}=await supabaseRequest('upi_payment_config?on_conflict=id','POST',{id:'primary',upi_id:upiId||null,payee_name:payeeName,enabled,updated_at:now},{Prefer:'resolution=merge-duplicates,return=representation'});
            await supabaseRequest('activity_log','POST',{action:'UPDATE_UPI_PAYMENT_CONFIG',table_name:'upi_payment_config',record_id:'primary',description:`Public UPI payments ${enabled?'enabled':'disabled'}`});
            return res.status(200).json({success:true,config:data?.[0]||{upi_id:upiId||null,payee_name:payeeName,enabled,updated_at:now}});
        }

        if(req.method==='POST'&&action==='confirm'){
            const requestId=validUuid(req.body?.request_id);const amount=positiveInt(req.body?.amount);const paymentDate=cleanDate(req.body?.payment_date);
            if(!requestId||!amount||!paymentDate)return res.status(400).json({error:'Request, received amount and payment date required'});
            try{
                await expireOldPending();
                const {data}=await supabaseRequest('rpc/abhi_confirm_upi_payment_request','POST',{p_request_id:requestId,p_amount:amount,p_payment_date:paymentDate,p_admin_note:cleanText(req.body?.admin_note,1000)});
                return res.status(200).json(Array.isArray(data)?(data[0]||{success:true}):(data||{success:true}));
            }catch(err){throw requestError(safeRpcMessage(err,'Payment confirmation failed'),409);}
        }

        if(req.method==='POST'&&action==='reject'){
            const requestId=validUuid(req.body?.request_id);if(!requestId)return res.status(400).json({error:'Valid request_id required'});
            try{
                const {data}=await supabaseRequest('rpc/abhi_reject_upi_payment_request','POST',{p_request_id:requestId,p_admin_note:cleanText(req.body?.admin_note,1000)});
                return res.status(200).json(Array.isArray(data)?(data[0]||{success:true}):(data||{success:true}));
            }catch(err){throw requestError(safeRpcMessage(err,'Payment request could not be rejected'),409);}
        }

        res.setHeader('Allow','GET, POST, PUT');return res.status(404).json({error:'Action not found'});
    }catch(err){return sendServerError(res,'UPI Payments API Error:',err);}
}
