/**
 * Clipency Account Connect Engine
 * Injected into /profile page — handles social account connection with 6-digit codes
 */
(function(){
'use strict';
if(window.__cxAccountsLoaded)return;
window.__cxAccountsLoaded=true;

const STYLE=`
.cxa-wrap{padding:24px 0}
.cxa-section-title{font-family:'DM Sans',sans-serif;font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--tm,rgba(255,255,255,.4));margin-bottom:16px}
.cxa-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:24px}
.cxa-platform-btn{background:rgba(196,149,106,.06);border:1px solid rgba(196,149,106,.18);border-radius:12px;padding:16px;cursor:pointer;transition:all .2s;text-align:left;color:var(--tp,#F5F0EB);font-family:'DM Sans',sans-serif}
.cxa-platform-btn:hover{background:rgba(196,149,106,.12);border-color:rgba(196,149,106,.35);transform:translateY(-1px)}
.cxa-platform-icon{font-size:22px;margin-bottom:6px}
.cxa-platform-name{font-size:13.5px;font-weight:600;display:block}
.cxa-platform-sub{font-size:11px;color:var(--ts,#B8AFA8);margin-top:2px}
.cxa-accounts-list{display:flex;flex-direction:column;gap:8px}
.cxa-account-card{background:rgba(196,149,106,.05);border:1px solid rgba(196,149,106,.12);border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:12px;transition:all .15s}
.cxa-acc-icon{font-size:22px;flex-shrink:0}
.cxa-acc-info{flex:1;min-width:0}
.cxa-acc-handle{font-size:13.5px;font-weight:600;color:var(--tp,#F5F0EB)}
.cxa-acc-meta{font-size:11.5px;color:var(--ts,#B8AFA8);margin-top:2px}
.cxa-acc-badge{display:inline-flex;align-items:center;padding:3px 10px;border-radius:20px;font-size:10.5px;font-weight:700;flex-shrink:0}
.cxa-acc-badge.verified,.cxa-acc-badge.approved{background:rgba(110,231,183,.12);color:#6EE7B7}
.cxa-acc-badge.pending{background:rgba(196,149,106,.15);color:#C4956A}
.cxa-acc-badge.rejected{background:rgba(248,113,113,.12);color:#F87171}
.cxa-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.8);backdrop-filter:blur(8px);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px}
.cxa-modal{background:#0A0908;border:1px solid rgba(196,149,106,.2);border-radius:16px;width:100%;max-width:460px;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.7)}
.cxa-modal h3{font-size:19px;font-weight:700;color:var(--tp,#F5F0EB);margin-bottom:6px}
.cxa-modal p{font-size:13px;color:var(--ts,#B8AFA8);margin-bottom:20px;line-height:1.6}
.cxa-code-display{background:rgba(196,149,106,.08);border:1px solid rgba(196,149,106,.25);border-radius:12px;padding:20px;text-align:center;margin-bottom:18px}
.cxa-code-num{font-size:40px;font-weight:900;letter-spacing:.3em;color:#C4956A;font-family:'Space Mono',monospace;display:block}
.cxa-code-exp{font-size:11px;color:var(--tm,rgba(255,255,255,.4));margin-top:6px}
.cxa-steps{background:rgba(255,255,255,.03);border-radius:10px;padding:14px 16px;margin-bottom:18px}
.cxa-step{display:flex;gap:10px;align-items:flex-start;margin-bottom:8px;font-size:13px;color:var(--ts,#B8AFA8);line-height:1.5}
.cxa-step:last-child{margin-bottom:0}
.cxa-step-num{width:20px;height:20px;border-radius:50%;background:rgba(196,149,106,.15);color:#C4956A;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
.cxa-input{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(196,149,106,.2);border-radius:8px;color:var(--tp,#F5F0EB);font-size:14px;padding:10px 13px;outline:none;font-family:'DM Sans',sans-serif;transition:border-color .15s;margin-bottom:12px}
.cxa-input:focus{border-color:rgba(196,149,106,.5)}
.cxa-input::placeholder{color:var(--tm,rgba(255,255,255,.3))}
.cxa-label{display:block;font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--tm,rgba(255,255,255,.4));margin-bottom:5px}
.cxa-btn-row{display:flex;gap:8px;margin-top:4px}
.cxa-btn{padding:10px 18px;border-radius:8px;font-size:13.5px;font-weight:600;cursor:pointer;border:none;font-family:'DM Sans',sans-serif;transition:all .15s}
.cxa-btn.primary{background:#C4956A;color:#0A0908}
.cxa-btn.primary:hover{background:#D4A57A}
.cxa-btn.ghost{background:rgba(255,255,255,.07);color:var(--tp,#F5F0EB);border:1px solid rgba(255,255,255,.1)}
.cxa-btn.ghost:hover{background:rgba(255,255,255,.12)}
.cxa-btn:disabled{opacity:.4;cursor:not-allowed}
.cxa-alert{padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:12px;line-height:1.5}
.cxa-alert.err{background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.2);color:#F87171}
.cxa-alert.ok{background:rgba(110,231,183,.1);border:1px solid rgba(110,231,183,.2);color:#6EE7B7}
.cxa-empty{padding:32px;text-align:center;color:var(--tm,rgba(255,255,255,.35));font-size:13.5px;background:rgba(255,255,255,.02);border-radius:12px;border:1px dashed rgba(255,255,255,.07)}
`;

const PLATFORMS=[
  {id:'youtube',name:'YouTube',icon:'📹',placeholder:'@yourchannel or channel URL'},
  {id:'instagram',name:'Instagram',icon:'📸',placeholder:'@yourhandle'},
  {id:'tiktok',name:'TikTok',icon:'🎵',placeholder:'@yourhandle'},
];

const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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

async function mount(){
  // Find the injection point — look for profile sections
  let target=document.querySelector('#accounts-section,#connect-accounts,[data-section="accounts"]');
  if(!target){
    // Find main scrollable content area
    target=document.querySelector('.main-content,.staff-main,.cx-main,main,.content-area');
    if(!target)target=document.body;
    // Create a dedicated section
    const section=document.createElement('div');
    section.id='cxa-injected';
    section.style.cssText='padding:0 32px 48px';
    target.appendChild(section);
    target=section;
  }

  const styleEl=document.createElement('style');
  styleEl.textContent=STYLE;
  document.head.appendChild(styleEl);

  target.innerHTML=`<div class="cxa-wrap"><div id="cxa-root"><div style="text-align:center;padding:40px;color:rgba(255,255,255,.4)">Loading accounts…</div></div></div>`;

  try{
    const sb=await getSb();
    const{data:{user}}=await sb.auth.getUser();
    if(!user)return;
    await renderAccounts(sb,user,target);
  }catch(e){
    target.innerHTML=`<div class="cxa-wrap"><div class="cxa-alert err">Could not load accounts: ${esc(e.message)}</div></div>`;
  }
}

async function renderAccounts(sb,user,target){
  const{data:accounts}=await sb.from('connected_accounts').select('*').eq('user_id',user.id).order('created_at',{ascending:false});

  const platformBtns=PLATFORMS.map(p=>`
    <button class="cxa-platform-btn" data-connect-platform="${p.id}">
      <div class="cxa-platform-icon">${p.icon}</div>
      <span class="cxa-platform-name">${p.name}</span>
      <div class="cxa-platform-sub">Connect ${p.name} account</div>
    </button>`).join('');

  const accountCards=(accounts||[]).length?(accounts||[]).map(a=>{
    const p=PLATFORMS.find(x=>x.id===a.platform?.toLowerCase())||{icon:'🔗',name:a.platform};
    const statusClass=a.status==='verified'?'verified':a.status==='pending'?'pending':'rejected';
    const statusLabel=a.status==='verified'?'✓ Verified':a.status==='pending'?'⏳ Pending':'✗ Rejected';
    return`<div class="cxa-account-card">
      <div class="cxa-acc-icon">${p.icon}</div>
      <div class="cxa-acc-info">
        <div class="cxa-acc-handle">@${esc(a.handle||a.username||'—')}</div>
        <div class="cxa-acc-meta">${p.name}${a.status==='pending'?` · Code: <strong style="color:#C4956A;font-family:monospace">${esc(a.verification_code)}</strong>`:''}${a.rejection_reason?`<div style="color:#F87171;font-size:11px;margin-top:2px">${esc(a.rejection_reason)}</div>`:''}</div>
      </div>
      <span class="cxa-acc-badge ${statusClass}">${statusLabel}</span>
    </div>`;
  }).join(''):`<div class="cxa-empty">No accounts connected yet. Connect your social accounts to start submitting clips.</div>`;

  target.innerHTML=`<div class="cxa-wrap">
    <div id="cxa-alert"></div>
    <div class="cxa-section-title">Connect a new account</div>
    <div class="cxa-grid">${platformBtns}</div>
    <div class="cxa-section-title">Your connected accounts</div>
    <div class="cxa-accounts-list">${accountCards}</div>
  </div>`;

  // Bind connect buttons
  target.querySelectorAll('[data-connect-platform]').forEach(btn=>{
    btn.addEventListener('click',()=>showConnectModal(sb,user,btn.dataset.connectPlatform,target));
  });
}

function showConnectModal(sb,user,platformId,target){
  const p=PLATFORMS.find(x=>x.id===platformId)||{id:platformId,name:platformId,icon:'🔗',placeholder:'@yourhandle'};
  const mid='cxam'+Date.now();
  const overlay=document.createElement('div');
  overlay.className='cxa-modal-overlay';
  overlay.innerHTML=`<div class="cxa-modal">
    <h3>${p.icon} Connect ${p.name}</h3>
    <p>Enter your ${p.name} handle. We'll generate a 6-digit code for you to put in your bio for verification.</p>
    <div id="${mid}_err"></div>
    <label class="cxa-label">Your ${p.name} handle</label>
    <input class="cxa-input" id="${mid}_handle" placeholder="${esc(p.placeholder)}" autocomplete="off"/>
    <div class="cxa-btn-row">
      <button class="cxa-btn ghost" id="${mid}_cancel">Cancel</button>
      <button class="cxa-btn primary" id="${mid}_gen">Generate Code</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const close=()=>document.body.removeChild(overlay);
  overlay.querySelector('#'+mid+'_cancel').onclick=close;
  overlay.querySelector('#'+mid+'_gen').onclick=async()=>{
    const handle=overlay.querySelector('#'+mid+'_handle').value.trim().replace(/^@/,'');
    if(!handle){overlay.querySelector('#'+mid+'_handle').focus();return;}
    const btn=overlay.querySelector('#'+mid+'_gen');
    const errEl=overlay.querySelector('#'+mid+'_err');
    btn.disabled=true;btn.textContent='Generating…';
    try{
      const{data,error}=await sb.rpc('clipper_connect_account',{p_platform:platformId,p_handle:handle});
      if(error)throw error;
      // Show code step
      overlay.querySelector('.cxa-modal').innerHTML=`
        <h3>${p.icon} Your verification code</h3>
        <p>Add this code to your ${p.name} bio and keep it there. Our team will verify it within 24 hours.</p>
        <div class="cxa-code-display">
          <span class="cxa-code-num">${esc(data.verification_code)}</span>
          <div class="cxa-code-exp">Valid for 48 hours · @${esc(handle)}</div>
        </div>
        <div class="cxa-steps">
          <div class="cxa-step"><div class="cxa-step-num">1</div><div>Open ${p.name} and go to your profile settings</div></div>
          <div class="cxa-step"><div class="cxa-step-num">2</div><div>Edit your bio and add the code: <strong style="color:#C4956A;font-family:monospace">${esc(data.verification_code)}</strong></div></div>
          <div class="cxa-step"><div class="cxa-step-num">3</div><div>Save your bio. Our team will verify within 24 hours.</div></div>
        </div>
        <div id="${mid}_done_err"></div>
        <div class="cxa-btn-row">
          <button class="cxa-btn ghost" id="${mid}_done">Done — I've added it</button>
        </div>`;
      overlay.querySelector('#'+mid+'_done').onclick=async()=>{
        close();
        await renderAccounts(sb,user,target);
      };
    }catch(e){
      errEl.innerHTML=`<div class="cxa-alert err">${esc(e.message||'Failed to generate code')}</div>`;
      btn.disabled=false;btn.textContent='Generate Code';
    }
  };
}

// Mount after DOM is ready and on profile/accounts pages
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);
else mount();
})();
