(function(){
  if (window.CLIPENCY_LAUNCH_FLOW_V2) return;
  window.CLIPENCY_LAUNCH_FLOW_V2 = true;

  const PLATFORMS = [
    { id:'youtube', name:'YouTube', icon:'▶', placeholder:'https://youtube.com/@yourchannel' },
    { id:'instagram', name:'Instagram', icon:'◎', placeholder:'https://instagram.com/yourhandle' },
    { id:'tiktok', name:'TikTok', icon:'♪', placeholder:'https://tiktok.com/@yourhandle' }
  ];

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const clean = v => String(v ?? '').replace(/\s+/g,' ').trim();
  const path = () => location.pathname.replace(/\/+$/,'').toLowerCase() || '/';
  const money = n => '$' + Number(n || 0).toLocaleString(undefined,{maximumFractionDigits:2});
  const fmt = v => v ? new Date(v).toLocaleString() : '—';

  function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

  async function client(){
    for(let i=0;i<80;i++){
      const c = window.clipencySupabase || window.supabaseClient || window.sbClient;
      if(c && c.auth && c.rpc) return c;
      await wait(80);
    }
    throw new Error('Supabase client missing. Refresh once or check supabaseClient.js loading.');
  }

  async function rpc(name, payload={}){
    const c = await client();
    const {data,error} = await c.rpc(name, payload);
    if(error) throw error;
    return data || [];
  }

  function toast(msg, type='ok'){
    let box = $('#cx-toast');
    if(!box){
      box = document.createElement('div');
      box.id = 'cx-toast';
      box.style.cssText = 'position:fixed;right:22px;bottom:22px;z-index:999999;background:rgba(28,20,15,.96);color:#fff8ef;border:1px solid rgba(224,172,120,.24);border-radius:16px;padding:14px 16px;font-weight:800;box-shadow:0 24px 80px rgba(0,0,0,.45);max-width:420px';
      document.body.appendChild(box);
    }
    box.textContent = msg;
    box.style.borderColor = type === 'error' ? 'rgba(255,90,90,.45)' : 'rgba(224,172,120,.28)';
    clearTimeout(box._t);
    box._t = setTimeout(()=>box.remove(),4500);
  }

  function modal(html){
    const old = $('#cx-modal'); if(old) old.remove();
    const wrap = document.createElement('div');
    wrap.id='cx-modal';
    wrap.style.cssText='position:fixed;inset:0;z-index:999998;background:rgba(0,0,0,.74);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;padding:22px';
    wrap.innerHTML = `<div style="width:min(620px,96vw);max-height:90vh;overflow:auto;background:linear-gradient(145deg,rgba(34,25,18,.98),rgba(9,7,5,.98));border:1px solid rgba(224,172,120,.28);border-radius:28px;padding:30px;color:#fff8ef;box-shadow:0 35px 100px rgba(0,0,0,.58);font-family:inherit;position:relative"><button data-close style="position:absolute;right:20px;top:18px;width:40px;height:40px;border-radius:13px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:white;font-size:24px;cursor:pointer">×</button>${html}</div>`;
    document.body.appendChild(wrap);
    $('[data-close]',wrap).onclick=()=>wrap.remove();
    return wrap;
  }

  function statusLabel(s){
    s=String(s||'').toLowerCase();
    if(s==='verified') return 'Connected';
    if(s==='pending') return 'Under Verification';
    if(s==='approved') return 'Approved';
    if(s==='paid') return 'Paid';
    if(s==='rejected') return 'Rejected';
    if(s==='expired') return 'Expired';
    return 'Not Connected';
  }

  function badge(s){
    s=String(s||'').toLowerCase();
    const colors = {
      verified:['rgba(80,230,150,.12)','#72f0aa'], approved:['rgba(80,230,150,.12)','#72f0aa'], paid:['rgba(80,230,150,.12)','#72f0aa'],
      pending:['rgba(255,211,90,.12)','#ffd35a'], rejected:['rgba(255,90,90,.12)','#ff9b9b'], expired:['rgba(255,90,90,.12)','#ff9b9b']
    };
    const c=colors[s]||['rgba(255,255,255,.07)','rgba(216,199,180,.72)'];
    return `<span style="display:inline-flex;border-radius:999px;padding:8px 12px;background:${c[0]};color:${c[1]};font-weight:900;font-size:12px;white-space:nowrap">${statusLabel(s)}</span>`;
  }

  function ensureSidebarAccounts(){
    if(!['/campaigns','/stats','/payouts','/wallet','/profile','/accounts'].includes(path())) return;
    if($('a[href="/accounts"]')) return;
    const links=$$('a');
    const profile=links.find(a=>/profile/i.test(clean(a.textContent)));
    const wallet=links.find(a=>/wallet/i.test(clean(a.textContent)));
    const ref=profile||wallet; if(!ref||!ref.parentElement) return;
    const a=ref.cloneNode(true);
    a.href='/accounts';
    function replace(n){ if(n.nodeType===3) n.nodeValue=n.nodeValue.replace(/Profile|Wallet/gi,'Accounts'); else n.childNodes.forEach(replace); }
    replace(a);
    if(!/accounts/i.test(clean(a.textContent))) a.appendChild(document.createTextNode(' Accounts'));
    a.classList.remove('active','selected','current');
    if(path()==='/accounts') { a.classList.add('active'); a.style.background='rgba(224,172,120,.11)'; a.style.color='#e0ac78'; }
    ref.parentElement.insertBefore(a, profile||ref);
  }

  async function openAccountModal(platformId, existing){
    const p = PLATFORMS.find(x=>x.id===platformId); if(!p) return;
    const wrap=modal(`
      <div style="color:#e0ac78;letter-spacing:.18em;text-transform:uppercase;font-size:11px;font-weight:900">Connect Account</div>
      <h2 style="margin:10px 0 8px;font-size:30px;font-family:Georgia,serif">Connect ${p.name}</h2>
      <p style="margin:0 0 20px;color:rgba(216,199,180,.72);line-height:1.55">Enter your ${p.name} username and profile URL. Clipency generates a 6-digit code. Verification is usually completed within 24 hours.</p>
      <label style="display:block;color:#e0ac78;font-size:12px;font-weight:900;letter-spacing:.16em;text-transform:uppercase">Username / Handle</label>
      <input id="cx-handle" value="${existing?.handle ? '@'+existing.handle : ''}" placeholder="@yourhandle" style="width:100%;margin:9px 0 16px;border-radius:16px;border:1px solid rgba(224,172,120,.38);background:rgba(255,255,255,.045);color:#fff8ef;padding:15px 17px;font-size:16px;outline:none;box-sizing:border-box">
      <label style="display:block;color:#e0ac78;font-size:12px;font-weight:900;letter-spacing:.16em;text-transform:uppercase">Profile URL</label>
      <input id="cx-url" value="${existing?.profile_url || ''}" placeholder="${p.placeholder}" style="width:100%;margin:9px 0 18px;border-radius:16px;border:1px solid rgba(224,172,120,.38);background:rgba(255,255,255,.045);color:#fff8ef;padding:15px 17px;font-size:16px;outline:none;box-sizing:border-box">
      ${existing?.status==='pending'?`<div style="padding:18px;border-radius:18px;border:1px solid rgba(224,172,120,.25);background:rgba(224,172,120,.08);text-align:center;margin-bottom:18px"><div style="color:#e0ac78;font-size:11px;letter-spacing:.16em;font-weight:900;text-transform:uppercase">Your verification code</div><strong style="display:block;margin-top:10px;color:#e0ac78;font-size:42px;letter-spacing:.24em">${existing.verification_code||'—'}</strong><p style="text-align:left;color:rgba(216,199,180,.74);line-height:1.5;margin:14px 0 0">Paste this code in your ${p.name} bio/profile. Your account will be reviewed and verified within 24 hours.</p></div>`:''}
      <button id="cx-submit-account" style="width:100%;border:0;border-radius:16px;background:#e0ac78;color:#080604;font-weight:950;padding:16px;cursor:pointer;font-size:16px">Generate 6-digit code →</button>`);
    $('#cx-submit-account',wrap).onclick = async()=>{
      const handle=clean($('#cx-handle',wrap).value); const url=clean($('#cx-url',wrap).value);
      if(!handle) return toast('Please enter your username.','error');
      try{
        const rows=await rpc('clipency_request_connected_account',{p_platform:platformId,p_handle:handle,p_profile_url:url});
        const row=Array.isArray(rows)?rows[0]:rows;
        wrap.remove(); toast(`${p.name} verification code generated: ${row.verification_code}. Reviewed within 24 hours.`);
        if(path()==='/accounts') renderAccountsPage(); else renderProfileAccountStatus();
      }catch(e){ toast(e.message||'Could not generate code.','error'); }
    };
  }

  async function renderAccountsPage(){
    if(path()!=='/accounts') return;
    const grid=$('#accounts-grid'); const err=$('#accounts-error'); if(!grid) return;
    if(err) err.textContent='';
    grid.innerHTML = PLATFORMS.map(()=>`<div class="cx-card"><div class="cx-skeleton"></div><div class="cx-skeleton short"></div><div class="cx-skeleton tiny"></div></div>`).join('');
    try{
      const rows=await rpc('clipency_my_connected_accounts');
      const map={}; rows.forEach(r=>map[r.platform]=r);
      grid.innerHTML=PLATFORMS.map(p=>{
        const a=map[p.id]; const st=a?.status || 'empty';
        return `<article class="cx-card">
          <div class="cx-top"><div class="cx-icon">${p.icon}</div><div><h2>${p.name}</h2><p>${a?.handle?'@'+a.handle:'No account added'}</p></div>${badge(st)}</div>
          <div class="cx-meta"><div><span>Verification code</span><strong>${a?.verification_code||'—'}</strong></div><div><span>Review timeline</span><strong>Within 24 hours</strong></div></div>
          <div class="cx-notice ${st}">${st==='verified'?'This account is connected.':st==='pending'?'Paste the 6-digit code in your bio/profile. Your account will be reviewed and verified within 24 hours.':st==='rejected'?(a.rejection_reason||'Rejected. Please retry with correct details.'):st==='expired'?'Previous code expired. Generate a new code.':'Add your account to start submitting clips from this platform.'}</div>
          ${a?.profile_url?`<a class="cx-link" href="${a.profile_url}" target="_blank">Open profile ↗</a>`:`<span class="cx-link muted">${p.placeholder}</span>`}
          <button class="cx-btn" data-add-account="${p.id}" ${st==='verified'?'disabled':''}>${st==='verified'?'Connected':st==='pending'?'View Status':st==='rejected'?'Retry':st==='expired'?'Generate New Code':'Add Account'}</button>
        </article>`;
      }).join('');
      $$('[data-add-account]',grid).forEach(btn=>btn.onclick=()=>openAccountModal(btn.dataset.addAccount,map[btn.dataset.addAccount]));
    }catch(e){ grid.innerHTML=''; if(err) err.textContent='Could not load connected accounts: '+(e.message||e); }
  }

  function createAccountsPageIfStatic(){
    if(path()!=='/accounts') return;
    if($('#accounts-grid')) return;
    document.body.innerHTML = `<div class="cx-shell"><aside class="cx-side"><div class="cx-logo">✂ CLIPENCY</div><div class="cx-label">Clipper</div><nav><a href="/campaigns">▻ Campaigns</a><a href="/stats">⌁ Stats</a><a href="/payouts">▭ Payouts</a><a href="/wallet">▣ Wallet</a><a class="active" href="/accounts">🔗 Accounts</a></nav><div class="cx-label">Account</div><nav><a href="/profile">♙ Profile</a></nav></aside><main class="cx-main"><div class="cx-eyebrow">Creator verification</div><h1>Accounts.</h1><p class="cx-sub">Connect your creator platforms with a 6-digit verification code. Verification is usually completed within 24 hours.</p><section id="accounts-grid" class="cx-grid"></section><div id="accounts-error" class="cx-error"></div></main></div>`;
  }

  async function renderProfileAccountStatus(){
    if(path()!=='/profile') return;
    try{
      const rows=await rpc('clipency_my_connected_accounts'); const map={}; rows.forEach(r=>map[r.platform]=r);
      const blocks=$$('section,article,div').filter(el=>/connected accounts/i.test(clean(el.textContent))).sort((a,b)=>a.getBoundingClientRect().height-b.getBoundingClientRect().height);
      const block=blocks[0]; if(!block) return;
      PLATFORMS.forEach(p=>{
        const row=$$('div,li,section,article',block).filter(el=>{const r=el.getBoundingClientRect();return r.height>35&&r.height<170&&clean(el.textContent).toLowerCase().includes(p.name.toLowerCase());}).sort((a,b)=>a.getBoundingClientRect().height-b.getBoundingClientRect().height)[0];
        if(!row) return;
        const a=map[p.id];
        const btn=$$('button,a,[role="button"]',row).find(x=>/add|edit|connect|verification|connected|retry|rejected/i.test(clean(x.textContent)));
        if(btn){ btn.textContent=a?statusLabel(a.status):'+ Add'; btn.style.pointerEvents='auto'; btn.style.cursor='pointer'; btn.onclick=(e)=>{e.preventDefault();e.stopPropagation();location.href='/accounts';}; }
        const leaves=$$('*',row).filter(el=>!el.children.length);
        const sub=leaves.find(el=>/no accounts connected|connected|under verification|rejected|expired|pending/i.test(clean(el.textContent)));
        if(sub){ sub.textContent=!a?'No account connected':a.status==='verified'?`@${a.handle} · Connected`:a.status==='pending'?`@${a.handle} · Under verification`:a.status==='rejected'?`@${a.handle} · Rejected`:`@${a.handle} · Code expired`; }
      });
    }catch(e){ console.warn('[Clipency profile account status]',e); }
  }

  function campaignInfo(){
    const title = clean($('h1')?.textContent || document.title || 'Campaign');
    const id = location.search.match(/[?&]id=([^&]+)/)?.[1] || location.hash.replace('#','') || title.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,80);
    return { id, title };
  }

  async function openSubmitClipModal(){
    try{
      const accs=await rpc('clipency_verified_accounts');
      if(!accs.length) { toast('Please connect and verify at least one social account before submitting clips.','error'); location.href='/accounts'; return; }
      const c=campaignInfo();
      const opts=accs.map(a=>`<option value="${a.id}">${a.platform} · @${a.handle}</option>`).join('');
      const wrap=modal(`<div style="color:#e0ac78;letter-spacing:.18em;text-transform:uppercase;font-size:11px;font-weight:900">Submit Clip</div><h2 style="font-family:Georgia,serif;font-size:30px;margin:10px 0">${c.title}</h2><p style="color:rgba(216,199,180,.72);line-height:1.55">Only connected accounts can submit clips. Your submission will go to Admin Reviews.</p><label class="cx-modal-label">Connected Account</label><select id="cx-submit-account-select" class="cx-modal-input">${opts}</select><label class="cx-modal-label">Clip/Post URL</label><input id="cx-submit-url" class="cx-modal-input" placeholder="https://..."><label class="cx-modal-label">Views / Proof metric</label><input id="cx-submit-views" class="cx-modal-input" type="number" value="0" min="0"><button id="cx-submit-clip" class="cx-modal-btn">Submit for Review →</button>`);
      $('#cx-submit-clip',wrap).onclick=async()=>{
        const account=$('#cx-submit-account-select',wrap).value; const url=clean($('#cx-submit-url',wrap).value); const views=Number($('#cx-submit-views',wrap).value||0);
        if(!url) return toast('Please paste the clip/post URL.','error');
        try{ await rpc('clipency_submit_clip',{p_campaign_id:c.id,p_campaign_title:c.title,p_connected_account_id:account,p_clip_url:url,p_views:views,p_proof_url:url}); wrap.remove(); toast('Clip submitted for admin review.'); }
        catch(e){ toast(e.message||'Clip submission failed.','error'); }
      };
    }catch(e){ toast(e.message||'Could not start clip submission.','error'); }
  }

  function bindCampaignSubmit(){
    if(path()!=='/campaigns') return;
    $$('button,a,[role="button"]').filter(el=>/submit.*clip|submit your clip/i.test(clean(el.textContent))).forEach(btn=>{
      if(btn.dataset.cxSubmitBound) return; btn.dataset.cxSubmitBound='1';
      btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openSubmitClipModal();},true);
    });
  }

  async function renderStatsSubmissions(){
    if(path()!=='/stats') return;
    try{
      const rows=await rpc('clipency_my_submissions');
      const panels=$$('section,article,div').filter(el=>/my submissions|rejected submissions/i.test(clean(el.textContent))).sort((a,b)=>b.getBoundingClientRect().width-a.getBoundingClientRect().width);
      const target=panels[0]; if(!target) return;
      target.innerHTML = `<div style="display:flex;gap:14px;align-items:center;justify-content:space-between;margin-bottom:18px"><h2 style="margin:0;font-family:Georgia,serif">My Submissions</h2><span>${rows.length} total</span></div>` + (rows.length?`<div style="display:grid;gap:12px">${rows.map(r=>`<div style="display:grid;grid-template-columns:1.4fr .7fr .7fr .8fr auto;gap:12px;align-items:center;border-top:1px solid rgba(224,172,120,.12);padding:14px 0"><strong>${r.campaign_title||'Campaign'}</strong><span>${r.platform||'—'} @${r.handle||''}</span><span>${r.views||0} views</span>${badge(r.status)}<a style="color:#e0ac78" target="_blank" href="${r.clip_url}">Open</a>${r.rejection_reason?`<small style="grid-column:1/-1;color:#ffb2b2">Reason: ${r.rejection_reason}</small>`:''}${r.approved_amount>0?`<small style="grid-column:1/-1;color:#72f0aa">Approved earning: ${money(r.approved_amount)}</small>`:''}</div>`).join('')}</div>`:`<p style="color:rgba(216,199,180,.72)">No submissions yet.</p>`);
    }catch(e){ console.warn('[Clipency stats submissions]',e); }
  }

  async function renderPayouts(){
    if(path()!=='/payouts') return;
    try{
      const summaryRows=await rpc('clipency_my_payout_summary'); const s=Array.isArray(summaryRows)?summaryRows[0]:summaryRows;
      const history=await rpc('clipency_my_payment_history');
      const bodyText=(document.body.innerText||'');
      function updateCard(label,value){
        const els=$$('div,section,article').filter(el=>clean(el.textContent).toLowerCase().includes(label.toLowerCase())).sort((a,b)=>a.getBoundingClientRect().height-b.getBoundingClientRect().height);
        const card=els[0]; if(!card) return;
        const amounts=$$('*',card).filter(el=>/^\$[\d,]+/.test(clean(el.textContent)) || clean(el.textContent)==='$0');
        const target=amounts.sort((a,b)=>b.getBoundingClientRect().height-a.getBoundingClientRect().height)[0];
        if(target) target.textContent=value;
      }
      updateCard('Available Balance', money(s?.available_balance||0));
      updateCard('Pending Payout', money(s?.pending_payout||0));
      updateCard('Paid', money(s?.paid_total||0));
      $$('button,a,[role="button"]').filter(el=>/withdraw/i.test(clean(el.textContent))).forEach(btn=>{ if(btn.dataset.cxWithdraw) return; btn.dataset.cxWithdraw='1'; btn.onclick=(e)=>{e.preventDefault();e.stopPropagation();openWithdrawModal(Number(s?.available_balance||0));}; });
      const panels=$$('section,article,div').filter(el=>/payout history|payment history/i.test(clean(el.textContent))).sort((a,b)=>b.getBoundingClientRect().width-a.getBoundingClientRect().width);
      const panel=panels[0]; if(panel){ panel.innerHTML=`<h2 style="font-family:Georgia,serif;margin:0 0 20px">Payment History</h2>${history.length?history.map(t=>`<div style="display:grid;grid-template-columns:1fr auto;gap:14px;align-items:center;border-top:1px solid rgba(224,172,120,.12);padding:16px 0"><div><strong>${t.campaign_title||t.note||t.type}</strong><span style="display:block;color:rgba(216,199,180,.62);margin-top:4px">${fmt(t.created_at)} · ${statusLabel(t.status)}</span></div><strong style="color:${Number(t.amount)>=0?'#72f0aa':'#fff8ef'}">${money(t.amount)}</strong></div>`).join(''):`<p style="color:rgba(216,199,180,.72)">No payout history yet.</p>`}`; }
    }catch(e){ console.warn('[Clipency payouts]',e); toast('Could not refresh payout data: '+(e.message||e),'error'); }
  }

  function openWithdrawModal(available){
    const wrap=modal(`<div style="color:#e0ac78;letter-spacing:.18em;text-transform:uppercase;font-size:11px;font-weight:900">Request Payout</div><h2 style="font-family:Georgia,serif;font-size:30px;margin:10px 0">Withdraw earnings</h2><p style="color:rgba(216,199,180,.72)">Available balance: <strong>${money(available)}</strong></p><label class="cx-modal-label">Amount</label><input id="cx-withdraw-amount" class="cx-modal-input" type="number" min="1" max="${available}" value="${available}"><label class="cx-modal-label">Payment note / method</label><input id="cx-withdraw-note" class="cx-modal-input" placeholder="Primary wallet/payment method"><button id="cx-withdraw-submit" class="cx-modal-btn">Request Payout →</button>`);
    $('#cx-withdraw-submit',wrap).onclick=async()=>{
      const amount=Number($('#cx-withdraw-amount',wrap).value||0); const note=clean($('#cx-withdraw-note',wrap).value);
      try{ await rpc('clipency_request_payout',{p_amount:amount,p_payment_method_snapshot:{note},p_note:note}); wrap.remove(); toast('Payout request sent to admin.'); renderPayouts(); }
      catch(e){ toast(e.message||'Could not request payout.','error'); }
    };
  }

  function injectStyles(){
    if($('#cx-launch-style')) return;
    const s=document.createElement('style'); s.id='cx-launch-style';
    s.textContent=`
      .cx-shell{display:grid;grid-template-columns:300px 1fr;min-height:100vh;background:radial-gradient(circle at 12% 12%,rgba(224,172,120,.12),transparent 30%),#050403;color:#fff8ef;font-family:Inter,system-ui,sans-serif}.cx-side{border-right:1px solid rgba(224,172,120,.15);background:linear-gradient(180deg,rgba(22,18,10,.94),rgba(5,4,3,.98));padding:36px 24px;position:sticky;top:0;height:100vh}.cx-logo{font-size:25px;font-weight:950;margin:0 0 58px}.cx-label{font-size:11px;letter-spacing:.28em;color:rgba(216,199,180,.48);font-weight:950;margin:28px 0 16px;text-transform:uppercase}.cx-side nav{display:grid;gap:8px}.cx-side a{color:rgba(216,199,180,.72);text-decoration:none;padding:15px 16px;border-radius:17px;font-weight:850;display:flex;gap:12px}.cx-side a.active,.cx-side a:hover{color:#e0ac78;background:rgba(224,172,120,.11)}.cx-main{padding:64px min(7vw,92px)}.cx-eyebrow{color:#e0ac78;letter-spacing:.24em;text-transform:uppercase;font-size:12px;font-weight:950}.cx-main h1{font-family:Georgia,serif;font-size:clamp(46px,6vw,86px);line-height:.95;letter-spacing:-.065em;margin:14px 0 16px}.cx-sub{color:rgba(216,199,180,.72);font-size:21px;line-height:1.45;max-width:850px;margin:0 0 36px}.cx-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}.cx-card{min-height:360px;border:1px solid rgba(224,172,120,.22);border-radius:30px;padding:28px;background:linear-gradient(145deg,rgba(31,23,17,.9),rgba(9,7,5,.95));box-shadow:0 30px 90px rgba(0,0,0,.28);transition:.25s ease}.cx-card:hover{transform:translateY(-3px);border-color:rgba(224,172,120,.36)}.cx-top{display:grid;grid-template-columns:58px 1fr auto;gap:16px;align-items:center;margin-bottom:26px}.cx-icon{height:58px;width:58px;border-radius:18px;display:grid;place-items:center;background:rgba(224,172,120,.1);border:1px solid rgba(224,172,120,.22);color:#e0ac78;font-size:24px;font-weight:950}.cx-top h2{margin:0;font-size:23px}.cx-top p{margin:5px 0 0;color:rgba(216,199,180,.72);font-weight:750}.cx-meta{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px}.cx-meta div{border:1px solid rgba(224,172,120,.13);background:rgba(255,255,255,.025);border-radius:18px;padding:16px}.cx-meta span{display:block;color:rgba(216,199,180,.48);font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:950}.cx-meta strong{display:block;margin-top:8px;font-size:17px}.cx-notice{border-radius:18px;padding:16px;background:rgba(224,172,120,.08);border:1px solid rgba(224,172,120,.16);color:rgba(216,199,180,.72);line-height:1.45;font-weight:700;margin-bottom:18px;min-height:80px}.cx-link{display:block;color:#e0ac78;text-decoration:none;font-weight:850;margin:10px 0 16px}.cx-link.muted{color:rgba(216,199,180,.48)}.cx-btn,.cx-modal-btn{width:100%;border:0;border-radius:17px;padding:15px 18px;background:#e0ac78;color:#080604;font-weight:950;cursor:pointer;font-size:16px}.cx-btn:disabled{opacity:.65;cursor:not-allowed}.cx-error{margin-top:22px;color:#ffaaaa;font-weight:850}.cx-skeleton{height:18px;border-radius:999px;background:linear-gradient(90deg,rgba(255,255,255,.04),rgba(255,255,255,.11),rgba(255,255,255,.04));margin:16px 0;width:70%;animation:cxPulse 1.2s infinite ease-in-out}.cx-skeleton.short{width:45%}.cx-skeleton.tiny{width:30%}@keyframes cxPulse{50%{opacity:.45}}.cx-modal-label{display:block;color:#e0ac78;font-size:12px;font-weight:900;letter-spacing:.16em;text-transform:uppercase;margin-top:14px}.cx-modal-input{width:100%;margin:8px 0 14px;border-radius:16px;border:1px solid rgba(224,172,120,.38);background:rgba(255,255,255,.045);color:#fff8ef;padding:15px 17px;font-size:16px;outline:none;box-sizing:border-box}@media(max-width:1100px){.cx-shell{grid-template-columns:1fr}.cx-side{position:relative;height:auto}.cx-grid{grid-template-columns:1fr}.cx-main{padding:42px 22px}}
    `; document.head.appendChild(s);
  }

  async function boot(){
    injectStyles(); ensureSidebarAccounts(); createAccountsPageIfStatic();
    await renderAccountsPage(); await renderProfileAccountStatus(); bindCampaignSubmit(); await renderStatsSubmissions(); await renderPayouts();
    setTimeout(()=>{ensureSidebarAccounts(); renderProfileAccountStatus(); bindCampaignSubmit();},1000);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
