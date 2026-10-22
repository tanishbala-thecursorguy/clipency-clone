/* ============================================================
   ADMIN OS · APPLICATIONS
   The queue for private campaigns.

   A private campaign is not open to the network: a clipper asks to be
   let in with one specific connected account, and somebody here says
   yes or no. Approving is what makes the campaign visible to them at
   all — the RLS policy on `campaigns` keys off exactly this table — so
   this page is the whole gate, not a formality in front of one.

   Every row carries the applicant's record on Clipency, because a
   decision made without it is a decision made on a handle alone.

   Registers itself into the console's PAGES / RENDERERS. Loaded after
   console.html's own script, before its first paint.
   ============================================================ */
(function(){
  'use strict';
  if(typeof PAGES==='undefined'||typeof RENDERERS==='undefined')return;

  /* ---- page registration, right after Accounts ---- */
  if(!PAGES.some(function(p){return p.id==='applications';})){
    var at=PAGES.findIndex(function(p){return p.id==='accounts';});
    PAGES.splice(at<0?PAGES.length:at+1,0,
      {id:'applications',label:'Applications',ic:'⚿',staff:true});
  }

  /* ---- motion + local styling ----------------------------------------
     Self-contained so the module drops in without touching console.html.
     Durations and easings are the transitions.dev token scale. */
  var css=''+
  ':root{--duration-quick:150ms;--duration-fast:250ms;--duration-slow:400ms;'+
    '--duration-very-slow:500ms;--duration-stagger:40ms;'+
    '--ease-smooth-out:cubic-bezier(0.22,1,0.36,1);--ease-in-out:ease-in-out;'+
    '--toast-open:350ms;--toast-close:250ms;--toast-distance:16px;'+
    '--toast-blur:2px;--toast-scale:0.97;--toast-ease:cubic-bezier(0.22,1,0.36,1);'+
    '--stagger-dur:500ms;--stagger-distance:12px;--stagger-stagger:40ms;'+
    '--stagger-blur:3px;--stagger-ease:cubic-bezier(0.22,1,0.36,1);}'+

  '.t-toast{position:fixed;left:50%;bottom:24px;z-index:9000;padding:11px 20px;border-radius:11px;'+
    'background:var(--ink-2,#111);color:var(--paper,#fff);font-size:13px;font-weight:600;'+
    'box-shadow:0 18px 40px -18px rgba(0,0,0,.5);pointer-events:none;max-width:88vw;'+
    'opacity:0;transform:translate(-50%,var(--toast-distance)) scale(var(--toast-scale));'+
    'filter:blur(var(--toast-blur));will-change:transform,opacity,filter;'+
    'transition:opacity var(--toast-close) var(--toast-ease),'+
               'transform var(--toast-close) var(--toast-ease),'+
               'filter var(--toast-close) var(--toast-ease);}'+
  '.t-toast.is-open{opacity:1;transform:translate(-50%,0) scale(1);filter:blur(0);'+
    'transition:opacity var(--toast-open) var(--toast-ease),'+
               'transform var(--toast-open) var(--toast-ease),'+
               'filter var(--toast-open) var(--toast-ease);}'+
  '@media (prefers-reduced-motion:reduce){.t-toast{transition:none !important;}}'+

  '.t-stagger > *{opacity:0;transform:translateY(var(--stagger-distance));filter:blur(var(--stagger-blur));}'+
  '.t-stagger.is-shown > *{animation:t-stagger-in var(--stagger-dur) var(--stagger-ease) both;}'+
  /* Stagger is capped at six cards on purpose: 6 x 40ms = 240ms, comfortably
     under the ~300ms where the last item starts to feel late. A queue of
     forty applications must not take a second and a half to appear, so
     everything past the sixth arrives with the sixth. */
  '.t-stagger.is-shown > *:nth-child(1){animation-delay:0ms;}'+
  '.t-stagger.is-shown > *:nth-child(2){animation-delay:calc(var(--stagger-stagger) * 1);}'+
  '.t-stagger.is-shown > *:nth-child(3){animation-delay:calc(var(--stagger-stagger) * 2);}'+
  '.t-stagger.is-shown > *:nth-child(4){animation-delay:calc(var(--stagger-stagger) * 3);}'+
  '.t-stagger.is-shown > *:nth-child(5){animation-delay:calc(var(--stagger-stagger) * 4);}'+
  '.t-stagger.is-shown > *:nth-child(n+6){animation-delay:calc(var(--stagger-stagger) * 5);}'+
  '@keyframes t-stagger-in{from{opacity:0;transform:translateY(var(--stagger-distance));'+
    'filter:blur(var(--stagger-blur));}to{opacity:1;transform:translateY(0);filter:blur(0);}}'+
  '@media (prefers-reduced-motion:reduce){.t-stagger > *{opacity:1;transform:none;filter:none;}'+
    '.t-stagger.is-shown > *{animation:none !important;}}'+

  '.ap-card{border:1px solid var(--hair,rgba(0,0,0,.1));border-radius:14px;padding:16px 18px;'+
    'margin-bottom:12px;background:var(--paper,transparent);'+
    'transition:border-color var(--duration-fast) var(--ease-smooth-out),'+
               'transform var(--duration-fast) var(--ease-smooth-out);}'+
  '.ap-card:hover{border-color:var(--gold,#C4956A);transform:translateY(-1px);}'+
  '.ap-top{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}'+
  '.ap-av{width:38px;height:38px;border-radius:11px;flex:none;overflow:hidden;'+
    'border:1px solid var(--hair,rgba(0,0,0,.1));display:flex;align-items:center;'+
    'justify-content:center;font-size:15px;color:var(--gold,#C4956A);}'+
  '.ap-av img{width:100%;height:100%;object-fit:cover;}'+
  '.ap-h{font-weight:700;font-size:14.5px;letter-spacing:-.01em;}'+
  '.ap-sub{font-size:11.5px;color:var(--ink-40,#888);}'+
  '.ap-act{margin-left:auto;display:flex;gap:8px;}'+
  '.ap-rec{display:flex;gap:20px;flex-wrap:wrap;margin-top:12px;padding-top:12px;'+
    'border-top:1px solid var(--hair,rgba(0,0,0,.08));}'+
  '.ap-rec div{min-width:86px;}'+
  '.ap-rec .k{display:block;font-family:var(--mono,monospace);font-size:8.5px;letter-spacing:.18em;'+
    'text-transform:uppercase;color:var(--ink-40,#888);}'+
  '.ap-rec .v{font-size:15px;font-weight:700;}'+
  '.ap-note{margin-top:12px;padding:10px 13px;border-radius:10px;font-size:12.5px;line-height:1.55;'+
    'background:var(--paper-2,rgba(0,0,0,.03));color:var(--ink-70,#444);}'+
  '.ap-note b{font-weight:600;}'+
  '.ap-flag{margin-top:10px;font-size:12px;color:var(--warn,#B08D4B);}';
  var st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);

  var toastEl=null;
  function toast(msg){
    if(!toastEl){toastEl=document.createElement('div');toastEl.className='t-toast';document.body.appendChild(toastEl);}
    toastEl.textContent=msg;
    toastEl.classList.remove('is-open'); void toastEl.offsetWidth;
    toastEl.classList.add('is-open');
    clearTimeout(toastEl._t);
    toastEl._t=setTimeout(function(){toastEl.classList.remove('is-open');},2800);
  }

  var AP={tab:'pending',rows:[],loaded:false};

  function profileUrl(a){
    if(a.account_url)return a.account_url;
    var h=String(a.account_handle||a.account_username||'').replace(/^@/,'');
    if(!h)return null;
    var p=String(a.account_platform||'').toLowerCase();
    if(p==='instagram')return 'https://instagram.com/'+encodeURIComponent(h);
    if(p==='tiktok')return 'https://tiktok.com/@'+encodeURIComponent(h);
    if(p==='youtube')return 'https://youtube.com/@'+encodeURIComponent(h);
    return null;
  }

  RENDERERS.applications=async function(force){
    if(force||!AP.loaded){
      var r=await sb.rpc('admin_list_applications',{p_status:'all'});
      if(r.error)throw new Error(r.error.message);
      AP.rows=Array.isArray(r.data)?r.data:[];
      AP.loaded=true;
    }
    var rows=AP.rows;
    var n=function(t){return t==='all'?rows.length:rows.filter(function(x){return x.status===t;}).length;};
    COUNTS.applications=n('pending');

    var list=AP.tab==='all'?rows:rows.filter(function(x){return x.status===AP.tab;});
    /* Oldest first in the pending queue — somebody has been waiting. */
    list=list.slice().sort(function(a,b){
      return AP.tab==='pending'
        ? String(a.created_at).localeCompare(String(b.created_at))
        : String(b.created_at).localeCompare(String(a.created_at));});

    var card=function(a){
      var url=profileUrl(a);
      var h=a.account_handle||a.account_username||'·';
      var approved=num(a.past_approved_clips), rejected=num(a.past_rejected_clips);
      var total=approved+rejected;
      var newcomer=total===0;
      return '<div class="ap-card">'+
        '<div class="ap-top">'+
          '<span class="ap-av">'+(a.account_avatar
            ? '<img src="'+esc(a.account_avatar)+'" alt="">'
            : esc(String(h).replace(/^@/,'').charAt(0).toUpperCase()||'?'))+'</span>'+
          '<div><div class="ap-h">'+(url
            ? '<a href="'+esc(url)+'" target="_blank" rel="noopener">@'+esc(String(h).replace(/^@/,''))+' ↗</a>'
            : '@'+esc(String(h).replace(/^@/,'')))+'</div>'+
            '<div class="ap-sub">'+esc(a.account_platform||'·')+' · '+
              esc(a.clipper_name||a.clipper_email||'unknown')+' · applied '+ago(a.created_at)+
              (num(a.attempt)>1?' · <b>second attempt</b>':'')+'</div></div>'+
          '<div style="margin-left:12px"><div class="ap-h" style="font-size:13px">'+esc(a.campaign_title||'·')+'</div>'+
            '<div class="ap-sub">the campaign they want in on</div></div>'+
          '<div class="ap-act">'+(a.status==='pending'
            ? '<button class="btn sm ok" data-apok="'+esc(a.id)+'">Approve</button>'+
              '<button class="btn sm danger" data-apno="'+esc(a.id)+'">Reject</button>'
            : '<span class="chip '+(a.status==='approved'?'ok':'no')+'">'+esc(a.status)+'</span>')+'</div>'+
        '</div>'+
        '<div class="ap-rec">'+
          '<div><span class="k">Approved clips</span><span class="v">'+fmt(approved)+'</span></div>'+
          '<div><span class="k">Total views</span><span class="v">'+fmtK(a.past_total_views)+'</span></div>'+
          '<div><span class="k">Rejected</span><span class="v"'+(rejected>approved?' style="color:var(--danger)"':'')+'>'+fmt(rejected)+'</span></div>'+
          '<div><span class="k">Handle verified</span><span class="v" style="font-size:12.5px;padding-top:3px">'+
            (a.account_verified_at?day(a.account_verified_at):'—')+'</span></div>'+
        '</div>'+
        (a.note?'<div class="ap-note"><b>They said:</b> '+esc(a.note)+'</div>':'')+
        (a.status==='rejected'&&a.rejection_reason
          ?'<div class="ap-note"><b>Turned down:</b> '+esc(a.rejection_reason)+'</div>':'')+
        (newcomer&&a.status==='pending'
          ?'<div class="ap-flag">No approved or rejected clips yet — nothing on Clipency to judge them by. The account link above is the only evidence.</div>':'')+
        (num(a.attempt)>1&&a.status==='pending'
          ?'<div class="ap-flag">This is their second and last attempt with this account. A rejection here is final.</div>':'')+
      '</div>';
    };

    return '<span id="apPage" hidden></span>'+
      '<div class="head"><div class="eyeb">Private campaigns</div><h1>Who gets let in.</h1>'+
      '<p class="sub">Approving an application is what makes a private campaign visible to that clipper, and it binds them to the one account they applied with — clips from any other account are refused. A rejection needs a reason, because they read it.</p></div>'+
      '<div class="kpis">'+
        '<div class="kpi"><span class="lab">Waiting</span><div class="big"'+(n('pending')?' style="color:var(--warn)"':'')+'>'+fmt(n('pending'))+'</div><div class="sub-t">need a decision</div></div>'+
        '<div class="kpi"><span class="lab">Approved</span><div class="big">'+fmt(n('approved'))+'</div><div class="sub-t">clippers on private work</div></div>'+
        '<div class="kpi"><span class="lab">Rejected</span><div class="big">'+fmt(n('rejected'))+'</div><div class="sub-t">turned down</div></div>'+
        '<div class="kpi"><span class="lab">Second attempts</span><div class="big">'+
          fmt(rows.filter(function(x){return num(x.attempt)>1&&x.status==='pending';}).length)+
          '</div><div class="sub-t">final call pending</div></div>'+
      '</div>'+
      '<div class="card">'+
        '<div class="ch"><div class="seg" id="apTabs">'+
          ['pending','approved','rejected','all'].map(function(t){
            return '<button class="'+(AP.tab===t?'on':'')+'" data-t="'+t+'">'+
              t.charAt(0).toUpperCase()+t.slice(1)+'<span class="n">'+n(t)+'</span></button>';}).join('')+
        '</div></div>'+
        (list.length
          ? '<div id="apList" class="t-stagger">'+list.slice(0,200).map(card).join('')+'</div>'
          : '<div class="empty"><div class="ei">⚿</div><b>Nothing waiting</b>'+
            '<p>No applications with this status. Private campaigns only generate one when a clipper asks to join.</p></div>')+
      '</div>';
  };

  RENDERERS.applications.after=function(){
    var l=$('#apList');
    if(l)requestAnimationFrame(function(){l.classList.add('is-shown');});

    $$('#apTabs button').forEach(function(b){
      b.onclick=function(){AP.tab=b.dataset.t;render();};});

    $$('[data-apok]').forEach(function(b){b.onclick=async function(){
      b.disabled=true;b.textContent='…';
      try{
        var r=await sb.rpc('admin_review_application',{p_id:b.dataset.apok,p_approve:true});
        if(r.error)throw new Error(r.error.message);
        toast('✓ Approved — the campaign is now visible to them');
        render(true);
      }catch(e){ b.disabled=false;b.textContent='Approve'; toast(e.message||String(e)); }
    };});

    $$('[data-apno]').forEach(function(b){b.onclick=function(){
      var id=b.dataset.apno;
      openModal(
        '<div class="eyeb">Private campaign</div><h3>Turn this application down</h3>'+
        '<p class="sub" style="margin-top:8px">The clipper sees this sentence on their dashboard, so write the actual reason. '+
        'If this is their second attempt it is the last thing they hear about this campaign.</p>'+
        '<div style="margin-top:14px"><textarea class="inp" id="apReason" rows="3" '+
          'style="resize:vertical;font-family:inherit;line-height:1.6" '+
          'placeholder="e.g. Your recent clips average under 500 views — build the account up and apply again."></textarea></div>'+
        '<div class="mrow"><button class="btn danger" id="apRejGo">Reject</button>'+
          '<button class="btn ghost" onclick="closeModal()">Cancel</button></div>'+
        '<div class="msg" id="apRejMsg"></div>',
      function(){
        var ta=$('#apReason'), go=$('#apRejGo'), msg=$('#apRejMsg');
        ta.focus();
        go.onclick=async function(){
          var reason=(ta.value||'').trim();
          if(!reason){msg.className='msg err';msg.textContent='A rejection needs a reason — the clipper sees it.';return;}
          go.disabled=true;go.textContent='Rejecting…';msg.className='msg';msg.textContent='';
          try{
            var r=await sb.rpc('admin_review_application',{p_id:id,p_approve:false,p_reason:reason});
            if(r.error)throw new Error(r.error.message);
            closeModal(); toast('Application rejected'); render(true);
          }catch(e){ msg.className='msg err'; msg.textContent=e.message||String(e);
            go.disabled=false; go.textContent='Reject'; }
        };
      });
    };});
  };
  /* ---- registration is a race, so it heals itself ---------------------
     console.html calls boot() at the end of its own inline script. boot()
     is async and its promises keep resolving while the browser is still
     fetching this file, so by the time we register into PAGES the nav —
     and possibly the whole first page — may already be painted. Waiting
     to be included is not an option; repaint instead.

     Bounded, and it stops the moment both conditions hold, so a console
     that never had the race pays one tick. */
  (function heal(tries){
    if(tries<=0)return;
    var nav=document.getElementById('nav');
    var listed=nav&&nav.querySelector('[data-id="applications"]');
    if(!listed&&typeof paintNav==='function'&&nav&&nav.children.length){
      try{paintNav();}catch(e){}
      listed=nav.querySelector('[data-id="applications"]');
    }
    var wanted=(location.hash||'').replace(/^#/,'').split('?')[0]==='applications';
    var shown=!!document.getElementById('apPage');
    if(listed&&(!wanted||shown))return;
    if(listed&&wanted&&!shown&&typeof render==='function'&&!window.busy){
      try{render(true);}catch(e){}
    }
    setTimeout(function(){heal(tries-1);},120);
  })(25);
})();
