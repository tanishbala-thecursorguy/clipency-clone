/**
 * Clipency Wallet Engine
 * Injects balance widget into dashboard + withdrawal UI into payouts page
 */
(function(){
'use strict';
if(window.__cxWalletLoaded)return;
window.__cxWalletLoaded=true;

const STYLE=`
.cxw-balance-card{background:linear-gradient(135deg,rgba(196,149,106,.12),rgba(196,149,106,.05));border:1px solid rgba(196,149,106,.25);border-radius:16px;padding:24px 28px;margin-bottom:24px}
.cxw-balance-label{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ts,#B8AFA8);margin-bottom:8px}
.cxw-balance-amount{font-size:42px;font-weight:800;letter-spacing:-.02em;color:var(--tp,#F5F0EB);line-height:1}
.cxw-balance-sub{font-size:12.5px;color:var(--ts,#B8AFA8);margin-top:6px}
.cxw-stats-row{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-top:16px}
.cxw-stat{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:14px}
.cxw-stat-l{font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:rgba(255,255,255,.35);margin-bottom:6px}
.cxw-stat-v{font-size:20px;font-weight:700;color:var(--tp,#F5F0EB)}
.cxw-stat-v.green{color:#6EE7B7}
.cxw-stat-v.amber{color:#C4956A}
.cxw-stat-v.red{color:#F87171}
.cxw-withdraw-btn{display:inline-flex;align-items:center;gap:7px;padding:11px 20px;border-radius:10px;background:#C4956A;color:#0A0908;font-size:13.5px;font-weight:700;cursor:pointer;border:none;font-family:'DM Sans',sans-serif;transition:all .15s;margin-top:16px}
.cxw-withdraw-btn:hover{background:#D4A57A;transform:translateY(-1px)}
.cxw-withdraw-btn:disabled{opacity:.4;cursor:not-allowed;transform:none}
.cxw-section-title{font-size:13px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--tm,rgba(255,255,255,.4));margin-bottom:14px;margin-top:28px}
.cxw-submissions{display:flex;flex-direction:column;gap:8px}
.cxw-sub-card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:12px 14px;display:flex;align-items:center;gap:12px}
.cxw-sub-info{flex:1;min-width:0}
.cxw-sub-title{font-size:13.5px;font-weight:600;color:var(--tp,#F5F0EB);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cxw-sub-meta{font-size:11.5px;color:var(--ts,#B8AFA8);margin-top:2px}
.cxw-sub-amount{font-size:15px;font-weight:700;flex-shrink:0}
.cxw-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:14px;font-size:10.5px;font-weight:700}
.cxw-badge.pending{background:rgba(196,149,106,.15);color:#C4956A}
.cxw-badge.approved{background:rgba(110,231,183,.12);color:#6EE7B7}
.cxw-badge.rejected{background:rgba(248,113,113,.12);color:#F87171}
.cxw-payout-hist{display:flex;flex-direction:column;gap:8px}
.cxw-payout-item{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.cxw-payout-left{flex:1}
.cxw-payout-label{font-size:13.5px;font-weight:600;color:var(--tp,#F5F0EB)}
.cxw-payout-meta{font-size:11.5px;color:var(--ts,#B8AFA8);margin-top:2px}
.cxw-empty{padding:28px;text-align:center;color:rgba(255,255,255,.3);font-size:13px;background:rgba(255,255,255,.02);border-radius:10px;border:1px dashed rgba(255,255,255,.07)}
/* Modal */
.cxw-overlay{position:fixed;inset:0;background:rgba(0,0,0,.82);backdrop-filter:blur(8px);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px}
.cxw-modal{background:#0A0908;border:1px solid rgba(196,149,106,.2);border-radius:16px;width:100%;max-width:420px;padding:28px}
.cxw-modal h3{font-size:18px;font-weight:700;color:var(--tp,#F5F0EB);margin-bottom:6px}
.cxw-modal .sub{font-size:13px;color:var(--ts,#B8AFA8);margin-bottom:20px;line-height:1.6}
.cxw-label{display:block;font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:rgba(255,255,255,.4);margin-bottom:5px}
.cxw-input{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(196,149,106,.18);border-radius:8px;color:var(--tp,#F5F0EB);font-size:14px;padding:10px 13px;outline:none;font-family:'DM Sans',sans-serif;transition:border-color .15s;margin-bottom:14px}
.cxw-input:focus{border-color:rgba(196,149,106,.5)}
.cxw-input::placeholder{color:rgba(255,255,255,.25)}
.cxw-btn-row{display:flex;gap:8px;margin-top:4px}
.cxw-btn{padding:10px 18px;border-radius:8px;font-size:13.5px;font-weight:600;cursor:pointer;border:none;font-family:'DM Sans',sans-serif;transition:all .15s}
.cxw-btn.primary{background:#C4956A;color:#0A0908}
.cxw-btn.primary:hover{background:#D4A57A}
.cxw-btn.ghost{background:rgba(255,255,255,.07);color:var(--tp,#F5F0EB);border:1px solid rgba(255,255,255,.1)}
.cxw-btn:disabled{opacity:.4;cursor:not-allowed}
.cxw-alert{padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:12px}
.cxw-alert.err{background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.2);color:#F87171}
.cxw-alert.ok{background:rgba(110,231,183,.1);border:1px solid rgba(110,231,183,.2);color:#6EE7B7}
`;

const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const fmtMoney=n=>n!=null?'₹'+Number(n).toLocaleString('en-IN'):'₹0';
const fmtDate=d=>d?new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'';

async function wait(ms){return new Promise(r=>setTimeout(r,ms));}
async function getSb(){
  for(let i=0;i<60;i++){
    const c=window.clipencySupabase||window.supabaseClient;
    if(c?.auth)return c;
    await wait(100);
  }
  throw new Error('Supabase not ready');
}

const IS_PAYOUTS=window.location.pathname.includes('payout')||window.location.pathname.includes('wallet');

async function init(){
  const styleEl=document.createElement('style');
  styleEl.textContent=STYLE;
  document.head.appendChild(styleEl);
  try{
    const sb=await getSb();
    const{data:{user}}=await sb.auth.getUser();
    if(!user)return;
    // Find injection target
    let target=document.querySelector('#wallet-section,#balance-section,#payout-section,[data-section="wallet"],[data-section="payouts"]');
    if(!target){
      const main=document.querySelector('.main-content,.staff-main,.cx-main,main');
      if(!main)return;
      target=document.createElement('div');
      target.id='cxw-injected';
      target.style.cssText='padding:0 32px 48px';
      if(IS_PAYOUTS)main.prepend(target);
      else main.appendChild(target);
    }
    await renderWallet(sb,user,target);
  }catch(e){console.warn('cxw init:',e.message);}
}

async function renderWallet(sb,user,target){
  // Load balance + recent submissions + payout history in parallel
  const[balRes,subsRes,payRes]=await Promise.all([
    sb.rpc('get_clipper_balance',{p_user_id:user.id}),
    sb.from('clip_submissions').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(15),
    sb.from('payout_requests').select('*').eq('user_id',user.id).order('requested_at',{ascending:false}).limit(10),
  ]);
  const bal=balRes.data||{available_balance:0,total_earned:0,total_withdrawn:0,pending_earnings:0,pending_withdrawal:0};
  const subs=subsRes.data||[];
  const pays=payRes.data||[];

  const statsHtml=`
    <div class="cxw-stats-row">
      <div class="cxw-stat"><div class="cxw-stat-l">Total Earned</div><div class="cxw-stat-v green">${fmtMoney(bal.total_earned)}</div></div>
      <div class="cxw-stat"><div class="cxw-stat-l">Total Withdrawn</div><div class="cxw-stat-v">${fmtMoney(bal.total_withdrawn)}</div></div>
      <div class="cxw-stat"><div class="cxw-stat-l">Pending Review</div><div class="cxw-stat-v amber">${fmtMoney(bal.pending_earnings)}</div></div>
      <div class="cxw-stat"><div class="cxw-stat-l">Pending Payout</div><div class="cxw-stat-v amber">${fmtMoney(bal.pending_withdrawal)}</div></div>
    </div>`;

  const subsHtml=subs.length?subs.map(s=>`<div class="cxw-sub-card">
    <div class="cxw-sub-info">
      <div class="cxw-sub-title">${esc(s.campaign_title||s.campaign_id||'Campaign')}</div>
      <div class="cxw-sub-meta">${esc(s.platform||'—')} · @${esc(s.handle||'—')} · ${fmtDate(s.created_at)}
        ${s.status==='rejected'&&s.rejection_reason?`<span style="color:#F87171"> · ${esc(s.rejection_reason.slice(0,50))}${s.rejection_reason.length>50?'…':''}</span>`:''}
      </div>
    </div>
    <div>
      <div class="cxw-sub-amount ${(s.status==='approved'||s.status==='flagged')?'green':s.status==='rejected'?'red':''}">${s.approved_amount?fmtMoney(s.approved_amount):'—'}</div>
      <div style="text-align:right;margin-top:4px"><span class="cxw-badge ${s.status}">${esc(s.status||'—')}</span></div>
    </div>
  </div>`).join(''):`<div class="cxw-empty">No submissions yet. Submit clips from the Campaigns page to start earning.</div>`;

  const paysHtml=pays.length?pays.map(p=>`<div class="cxw-payout-item">
    <div class="cxw-payout-left">
      <div class="cxw-payout-label">${fmtMoney(p.amount)} withdrawal</div>
      <div class="cxw-payout-meta">${fmtDate(p.requested_at)}${p.transaction_reference?` · Ref: ${esc(p.transaction_reference)}`:''}${p.status==='paid'?` · Paid on ${fmtDate(p.processed_at)}`:''}</div>
    </div>
    <span class="cxw-badge ${p.status}">${esc(p.status||'—')}</span>
  </div>`).join(''):`<div class="cxw-empty">No withdrawal requests yet.</div>`;

  const canWithdraw=Number(bal.available_balance)>0;

  target.innerHTML=`<div style="padding:${IS_PAYOUTS?'0':'24px 0'}">
    <div class="cxw-balance-card">
      <div class="cxw-balance-label">Available Balance</div>
      <div class="cxw-balance-amount">${fmtMoney(bal.available_balance)}</div>
      <div class="cxw-balance-sub">Ready to withdraw · Updates instantly when clips are approved</div>
      ${statsHtml}
      <button class="cxw-withdraw-btn" id="cxw-withdraw-btn" ${canWithdraw?'':'disabled'}>
        💸 ${canWithdraw?'Withdraw Funds':'No Balance to Withdraw'}
      </button>
    </div>
    ${IS_PAYOUTS?`<div class="cxw-section-title">Withdrawal history</div><div class="cxw-payout-hist">${paysHtml}</div>`:''}
    <div class="cxw-section-title">Recent submissions</div>
    <div class="cxw-submissions">${subsHtml}</div>
  </div>`;

  if(canWithdraw){
    target.querySelector('#cxw-withdraw-btn').addEventListener('click',()=>showWithdrawModal(sb,user,Number(bal.available_balance),target));
  }
}

function showWithdrawModal(sb,user,maxAmount,target){
  const mid='cxwm'+Date.now();
  const overlay=document.createElement('div');
  overlay.className='cxw-overlay';
  overlay.innerHTML=`<div class="cxw-modal">
    <h3>Withdraw Funds</h3>
    <div class="sub">Available: <strong style="color:#C4956A">${fmtMoney(maxAmount)}</strong><br>Withdrawals are processed within 2–3 business days.</div>
    <div id="${mid}_err"></div>
    <label class="cxw-label">Amount to withdraw (₹)</label>
    <input class="cxw-input" id="${mid}_amount" type="number" min="1" max="${maxAmount}" step="1" placeholder="Enter amount"/>
    <label class="cxw-label">Payment details / note (optional)</label>
    <input class="cxw-input" id="${mid}_note" placeholder="UPI ID, bank details, or any note"/>
    <div class="cxw-btn-row">
      <button class="cxw-btn ghost" id="${mid}_cancel">Cancel</button>
      <button class="cxw-btn primary" id="${mid}_req">Request Withdrawal</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const close=()=>document.body.removeChild(overlay);
  overlay.querySelector('#'+mid+'_cancel').onclick=close;
  overlay.querySelector('#'+mid+'_req').onclick=async()=>{
    const amount=parseFloat(overlay.querySelector('#'+mid+'_amount').value);
    const note=overlay.querySelector('#'+mid+'_note').value.trim()||null;
    const errEl=overlay.querySelector('#'+mid+'_err');
    if(!amount||amount<1){errEl.innerHTML='<div class="cxw-alert err">Enter a valid amount (minimum ₹1).</div>';return;}
    if(amount>maxAmount){errEl.innerHTML=`<div class="cxw-alert err">Cannot exceed available balance of ${fmtMoney(maxAmount)}.</div>`;return;}
    const btn=overlay.querySelector('#'+mid+'_req');
    btn.disabled=true;btn.textContent='Requesting…';
    try{
      const{data,error}=await sb.rpc('clipper_request_payout',{p_amount:amount,p_note:note});
      if(error)throw error;
      overlay.querySelector('.cxw-modal').innerHTML=`<div style="text-align:center;padding:20px 0">
        <div style="font-size:40px;margin-bottom:14px">✅</div>
        <h3 style="margin-bottom:8px">Request submitted!</h3>
        <p style="color:rgba(255,255,255,.5);font-size:13.5px;line-height:1.6">${fmtMoney(amount)} withdrawal has been requested. We'll process it within 2–3 business days.</p>
        <button class="cxw-btn ghost" style="margin-top:18px" onclick="this.closest('.cxw-overlay').remove()">Close</button>
      </div>`;
      // Reload wallet after 1.5s
      setTimeout(async()=>{
        try{const sb2=await getSb();await renderWallet(sb2,user,target);}catch{}
      },1500);
    }catch(e){
      errEl.innerHTML=`<div class="cxw-alert err">${esc(e.message||'Request failed')}</div>`;
      btn.disabled=false;btn.textContent='Request Withdrawal';
    }
  };
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
else init();
})();
