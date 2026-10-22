/**
 * Clipency Clip Submit Engine
 * Adds "Submit Clip" functionality to campaigns page
 */
(function(){
'use strict';
if(window.__cxClipSubmitLoaded)return;
window.__cxClipSubmitLoaded=true;

const STYLE=`
.cxs-overlay{position:fixed;inset:0;background:rgba(0,0,0,.82);backdrop-filter:blur(8px);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px}
.cxs-modal{background:#0A0908;border:1px solid rgba(196,149,106,.2);border-radius:16px;width:100%;max-width:480px;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.7);max-height:90vh;overflow-y:auto}
.cxs-modal h3{font-size:18px;font-weight:700;color:var(--tp,#F5F0EB);margin-bottom:4px}
.cxs-modal .sub{font-size:13px;color:var(--ts,#B8AFA8);margin-bottom:20px;line-height:1.5}
.cxs-label{display:block;font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--tm,rgba(255,255,255,.4));margin-bottom:5px}
.cxs-input,.cxs-select{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(196,149,106,.18);border-radius:8px;color:var(--tp,#F5F0EB);font-size:13.5px;padding:10px 13px;outline:none;font-family:'DM Sans',sans-serif;transition:border-color .15s;margin-bottom:14px}
.cxs-input:focus,.cxs-select:focus{border-color:rgba(196,149,106,.5)}
.cxs-input::placeholder{color:rgba(255,255,255,.25)}
.cxs-select option{background:#111}
.cxs-acct-card{background:rgba(196,149,106,.06);border:1px solid rgba(196,149,106,.15);border-radius:8px;padding:10px 13px;margin-bottom:8px;cursor:pointer;transition:all .15s;font-size:13px;color:var(--tp,#F5F0EB)}
.cxs-acct-card:hover,.cxs-acct-card.sel{background:rgba(196,149,106,.14);border-color:rgba(196,149,106,.4)}
.cxs-acct-card .acct-meta{font-size:11px;color:var(--ts,#B8AFA8);margin-top:2px}
.cxs-btn-row{display:flex;gap:8px;margin-top:8px}
.cxs-btn{padding:10px 18px;border-radius:8px;font-size:13.5px;font-weight:600;cursor:pointer;border:none;font-family:'DM Sans',sans-serif;transition:all .15s}
.cxs-btn.primary{background:#C4956A;color:#0A0908}
.cxs-btn.primary:hover{background:#D4A57A}
.cxs-btn.ghost{background:rgba(255,255,255,.07);color:var(--tp,#F5F0EB);border:1px solid rgba(255,255,255,.1)}
.cxs-btn.ghost:hover{background:rgba(255,255,255,.12)}
.cxs-btn:disabled{opacity:.4;cursor:not-allowed}
.cxs-alert{padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:12px;line-height:1.5}
.cxs-alert.err{background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.2);color:#F87171}
.cxs-alert.ok{background:rgba(110,231,183,.1);border:1px solid rgba(110,231,183,.2);color:#6EE7B7}
.cxs-alert.warn{background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.2);color:#fbbf24}
.cxs-no-accounts{background:rgba(196,149,106,.05);border:1px solid rgba(196,149,106,.12);border-radius:10px;padding:16px;font-size:13px;color:var(--ts,#B8AFA8);line-height:1.6;margin-bottom:12px}
.cxs-submit-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer;border:1px solid rgba(196,149,106,.3);background:rgba(196,149,106,.1);color:#C4956A;font-family:'DM Sans',sans-serif;transition:all .15s;margin-top:10px}
.cxs-submit-btn:hover{background:rgba(196,149,106,.2);border-color:rgba(196,149,106,.5)}
`;

const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const PLATFORM_ICONS={youtube:'📹',instagram:'📸',tiktok:'🎵',all:'🌐'};

async function wait(ms){return new Promise(r=>setTimeout(r,ms));}
async function getSb(){
  for(let i=0;i<60;i++){
    const c=window.clipencySupabase||window.supabaseClient;
    if(c?.auth)return c;
    await wait(100);
  }
  throw new Error('Supabase not ready');
}

let _sb=null,_user=null,_verifiedAccounts=[];

async function init(){
  const styleEl=document.createElement('style');
  styleEl.textContent=STYLE;
  document.head.appendChild(styleEl);
  try{
    _sb=await getSb();
    const{data:{user}}=await _sb.auth.getUser();
    if(!user)return;
    _user=user;
    const{data}=await _sb.from('connected_accounts').select('*').eq('user_id',user.id).eq('status','verified');
    _verifiedAccounts=data||[];
    injectSubmitButtons();
    const observer=new MutationObserver(()=>injectSubmitButtons());
    observer.observe(document.body,{childList:true,subtree:true});
  }catch(e){console.warn('cxs init:',e.message);}
}

function injectSubmitButtons(){
  const cards=document.querySelectorAll('[data-campaign-id],[data-id*="campaign"],[class*="campaign-card"],[class*="campaign-item"]');
  cards.forEach(card=>{
    if(card.querySelector('.cxs-submit-btn'))return;
    const campaignId=card.dataset.campaignId||card.dataset.id||card.getAttribute('data-id');
    const campaignTitle=card.querySelector('[class*="title"],[class*="name"],h2,h3,h4')?.textContent?.trim()||'Campaign';
    if(!campaignId)return;
    const btn=document.createElement('button');
    btn.className='cxs-submit-btn';
    btn.innerHTML='📎 Submit Clip';
    btn.setAttribute('data-submit-campaign',campaignId);
    btn.setAttribute('data-campaign-title',campaignTitle);
    btn.onclick=e=>{e.stopPropagation();showSubmitModal(campaignId,campaignTitle);};
    card.appendChild(btn);
  });
}

function showSubmitModal(campaignId,campaignTitle){
  const mid='cxsm'+Date.now();
  const hasAccounts=_verifiedAccounts.length>0;
  const accountsHtml=hasAccounts
    ?_verifiedAccounts.map(a=>{
        const icon=PLATFORM_ICONS[a.platform?.toLowerCase()]||'🔗';
        return`<div class="cxs-acct-card" data-acct-id="${esc(a.id)}" onclick="document.querySelectorAll('.cxs-acct-card').forEach(x=>x.classList.remove('sel'));this.classList.add('sel');document.getElementById('${mid}_sel').value=this.dataset.acctId">
          ${icon} <strong>@${esc(a.handle||a.username)}</strong>
          <div class="acct-meta">${esc(a.platform)} · verified</div>
        </div>`;
      }).join('')
    :`<div class="cxs-no-accounts">You don't have any verified accounts yet. Go to <a href="/profile" style="color:#C4956A">Profile → Accounts</a> to connect your social accounts first.</div>`;

  const overlay=document.createElement('div');
  overlay.className='cxs-overlay';
  overlay.innerHTML=`<div class="cxs-modal">
    <h3>Submit Clip</h3>
    <div class="sub">Submitting for: <strong style="color:#C4956A">${esc(campaignTitle)}</strong></div>
    <div id="${mid}_err"></div>
    <input type="hidden" id="${mid}_sel" value=""/>
    <label class="cxs-label">Select account to submit from</label>
    ${accountsHtml}
    ${hasAccounts?`
      <label class="cxs-label">Clip URL *</label>
      <input class="cxs-input" id="${mid}_url" placeholder="https://youtube.com/... or instagram.com/reel/..."/>
      <label class="cxs-label">Views count (approximate)</label>
      <input class="cxs-input" id="${mid}_views" type="number" min="0" placeholder="e.g. 125000"/>
    `:''}
    <div class="cxs-btn-row">
      <button class="cxs-btn ghost" id="${mid}_cancel">Cancel</button>
      ${hasAccounts?`<button class="cxs-btn primary" id="${mid}_submit">Submit Clip</button>`:''}
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const close=()=>document.body.removeChild(overlay);
  overlay.querySelector('#'+mid+'_cancel').onclick=close;
  if(!hasAccounts)return;
  overlay.querySelector('#'+mid+'_submit').onclick=async()=>{
    const accountId=overlay.querySelector('#'+mid+'_sel').value;
    const clipUrl=overlay.querySelector('#'+mid+'_url').value.trim();
    const views=parseInt(overlay.querySelector('#'+mid+'_views').value)||0;
    const errEl=overlay.querySelector('#'+mid+'_err');
    if(!accountId){errEl.innerHTML='<div class="cxs-alert err">Please select an account.</div>';return;}
    if(!clipUrl||!clipUrl.startsWith('http')){overlay.querySelector('#'+mid+'_url').focus();errEl.innerHTML='<div class="cxs-alert err">Please enter a valid clip URL starting with https://</div>';return;}
    const btn=overlay.querySelector('#'+mid+'_submit');
    btn.disabled=true;btn.textContent='Submitting…';
    try{
      const{data,error}=await _sb.rpc('clipper_submit_clip',{
        p_campaign_id:campaignId,p_account_id:accountId,p_clip_url:clipUrl,p_views:views
      });
      if(error)throw error;
      overlay.querySelector('.cxs-modal').innerHTML=`
        <div style="text-align:center;padding:20px 0">
          <div style="font-size:40px;margin-bottom:16px">✅</div>
          <h3 style="margin-bottom:8px">Clip submitted!</h3>
          <p style="color:rgba(255,255,255,.5);font-size:13.5px;line-height:1.6">Your clip has been submitted for review. You'll earn once it's approved by our team.</p>
          <button class="cxs-btn ghost" style="margin-top:18px" onclick="this.closest('.cxs-overlay').remove()">Close</button>
        </div>`;
    }catch(e){
      const msg=e.message||'';
      const isDuplicate=msg.includes('duplicate_clip_url');
      if(isDuplicate){
        errEl.innerHTML=`<div class="cxs-alert warn">
          <strong>⚠ This clip is already in our system.</strong><br>
          Each clip URL can only be submitted to Clipency once — by any clipper. Please submit a different clip.
        </div>`;
      }else{
        errEl.innerHTML=`<div class="cxs-alert err">${esc(msg||'Submission failed — please try again.')}</div>`;
      }
      btn.disabled=false;btn.textContent='Submit Clip';
    }
  };
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
else init();
})();
