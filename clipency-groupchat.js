/* ============================================================
   CLIPENCY · CAMPAIGN GROUP CHAT
   One room per campaign: the client, every creator posting for it,
   and Clipency. Off until the client turns it on. Creators open it
   from the campaign page (slides in from the right); the client runs
   it from their portal; admins supervise every room.

     CXGroupChat.status(sb, campaignId)            -> summary {enabled, role, unread, ...}
     CXGroupChat.drawer(sb, campaignId, {title})    -> opens the right-hand panel
     CXGroupChat.mount(el, {sb, campaignId, role})  -> inline room (client view, with on/off)
     CXGroupChat.admin(el, {sb})                    -> every room, list + chat

   Everything goes through rpcs (gc_list, gc_status, gc_messages, gc_post,
   gc_set_enabled), which check membership and refuse contact details and
   outside links server-side. Needs clipency-appeals.js for shared helpers.
   ============================================================ */
(function(){
  'use strict';
  if(window.CXGroupChat)return;
  var POLL_MS=3000;
  var U=function(){return (window.CXAppeals&&CXAppeals._util)||{};};
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function errText(e){return (e&&(e.message||e.error_description||e.msg))||String(e||'Something went wrong');}
  function when(d){return d?new Date(d).toLocaleString('en-US',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):'';}
  function ago(d){return U().ago?U().ago(d):when(d);}

  /* same rules as the server: no contact details; social links only (+ Drive/Docs for client & Clipency) */
  var SOCIAL='instagram\\.com|instagr\\.am|youtube\\.com|youtu\\.be|facebook\\.com|fb\\.com|fb\\.watch|tiktok\\.com|vm\\.tiktok\\.com|clipency\\.in';
  var DOCS='drive\\.google\\.com|docs\\.google\\.com';
  var CONTACT=[
    [/[\w.+-]+@[\w-]+\.[\w.-]+/,'email addresses'],
    [/(?:\+?\d[\s().-]?){8,}/,'phone numbers'],
    [/\b(whats\s?app|telegram|signal app|snap\s?chat|wechat|discord(?:\.gg)?|wa\.me|t\.me|skype)\b/i,'other chat apps'],
    [/\b(dm me|text me|call me|my number|phone number|contact me (?:on|at)|message me on|reach me (?:on|at))\b/i,'requests to talk privately']
  ];
  function allowedRe(role){return new RegExp('^https?:\\/\\/(?:www\\.|m\\.)?(?:'+(role==='creator'?SOCIAL:SOCIAL+'|'+DOCS)+')(?:[\\/?#]|$)','i');}
  /* no payment talk between creators and the client (Clipency's own posts are exempt) */
  var MONEY=/[$₹€£¥]|\b(rs\.?|inr|usd|eur|gbp|rupees?|dollars?|euros?|pounds?|bucks|paisa|lakhs?|lacs?|crores?|pay|paid|pays|paying|payment|payments|payout|payouts|money|cash|price|prices|pricing|rate|rates|rpm|cpm|fee|fees|salary|earn|earns|earned|earning|earnings|budget|budgets|invoice|invoices|upi|paypal|bank|transfer|tip|tips|bonus|bonuses|commission|compensation|per view|per video|per reel|per clip)\b/i;
  function check(text,role){
    text=text||'';
    for(var i=0;i<CONTACT.length;i++)if(CONTACT[i][0].test(text))return CONTACT[i][1];
    if(role!=='admin'&&MONEY.test(text))return 'payment or money talk (amounts, currencies, rates or payouts)';
    var urls=text.match(/https?:\/\/\S+/gi)||[], ok=allowedRe(role);
    for(var j=0;j<urls.length;j++)if(!ok.test(urls[j]))return role==='creator'
      ?'outside links (only Instagram, YouTube, Facebook and TikTok links)'
      :'outside links (only Instagram, YouTube, Facebook, TikTok and Google Drive/Docs links)';
    return '';
  }
  /* escape, then turn allowed links into links */
  function linkify(t){
    return esc(t).replace(/https?:\/\/[^\s<]+/gi,function(u){
      return '<a href="'+u+'" target="_blank" rel="noopener noreferrer">'+u+'</a>';
    });
  }

  function style(){
    if(document.getElementById('cxg-style'))return;
    var s=document.createElement('style');s.id='cxg-style';
    s.textContent=
    '.cxg{--g-bg:#FFFFFF;--g-bg2:#F6F3EE;--g-ink:#141210;--g-ink2:rgba(20,18,16,.62);--g-ink3:rgba(20,18,16,.42);--g-line:rgba(20,18,16,.1);'+
      '--g-acc:#8C6A45;--g-accbg:rgba(140,106,69,.1);--g-me:#141210;--g-mefg:#fff;--g-bad:#B4544A;--g-ok:#3E8A52;color:var(--g-ink);font-size:13.5px;text-align:left}'+
    'html[data-theme="dark"] .cxg{--g-bg:#161411;--g-bg2:#1D1A16;--g-ink:#EFEBE3;--g-ink2:rgba(239,235,227,.65);--g-ink3:rgba(239,235,227,.42);'+
      '--g-line:rgba(239,235,227,.09);--g-acc:#D8AA74;--g-accbg:rgba(216,170,116,.12);--g-me:#EFEBE3;--g-mefg:#0B0A08;--g-bad:#E0A196;--g-ok:#9DD6A8}'+
    '.cxg *{box-sizing:border-box}'+
    '.cxg-room{display:flex;flex-direction:column;min-height:0;height:100%;background:var(--g-bg2)}'+
    '.cxg-head{display:flex;align-items:center;gap:10px;padding:14px 16px;background:var(--g-bg);border-bottom:1px solid var(--g-line);flex-wrap:wrap}'+
    '.cxg-head .ti{font-weight:600;font-size:15px}.cxg-head .su{font-size:12px;color:var(--g-ink3);margin-top:1px}'+
    '.cxg-head .sp{flex:1}'+
    '.cxg-x{border:0;background:none;color:var(--g-ink2);font-size:20px;cursor:pointer;padding:2px 6px;border-radius:6px}.cxg-x:hover{background:var(--g-bg2);color:var(--g-ink)}'+
    '.cxg-live{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:600;color:var(--g-ok);letter-spacing:.04em}'+
    '.cxg-live i{width:7px;height:7px;border-radius:50%;background:currentColor;animation:cxgPulse 1.6s infinite}'+
    '@keyframes cxgPulse{0%{opacity:1}50%{opacity:.3}100%{opacity:1}}'+
    '.cxg-note{display:flex;align-items:center;gap:8px;padding:8px 16px;font-size:11.5px;line-height:1.4;color:var(--g-ink2);background:var(--g-accbg);border-bottom:1px solid var(--g-line)}'+
    '.cxg-note b{color:var(--g-ink);font-weight:600}'+
    '.cxg-paused{padding:13px 16px;text-align:center;font-size:12.5px;color:var(--g-ink2);border-top:1px solid var(--g-line);background:var(--g-bg)}'+
    '.cxg-mod{display:none;gap:4px;padding:0 4px}.cxg-m:hover .cxg-mod{display:flex}'+
    '.cxg-mod button{border:1px solid var(--g-line);background:var(--g-bg);color:var(--g-ink2);font:inherit;font-size:10.5px;font-weight:600;padding:2px 7px;border-radius:5px;cursor:pointer}'+
    '.cxg-mod button:hover{color:var(--g-bad);border-color:var(--g-bad)}'+
    '.cxg-bans[hidden],.cxg-paused[hidden]{display:none!important}'+
    '.cxg-bans{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:7px 16px;font-size:11.5px;color:var(--g-ink3);border-bottom:1px solid var(--g-line);background:var(--g-bg)}'+
    '.cxg-bans span{display:inline-flex;align-items:center;gap:4px;padding:2px 4px 2px 8px;border-radius:999px;border:1px solid var(--g-line);color:var(--g-ink2)}'+
    '.cxg-bans button{border:0;background:none;color:var(--g-ink3);cursor:pointer;font-size:13px;line-height:1}'+
    '.cxg-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:9px;min-height:0}'+
    '.cxg-sys{align-self:center;font-size:11.5px;color:var(--g-ink3);background:var(--g-bg);border:1px solid var(--g-line);padding:5px 12px;border-radius:999px;text-align:center;max-width:92%}'+
    '.cxg-m{max-width:80%;display:flex;flex-direction:column;gap:3px}'+
    '.cxg-m.me{align-self:flex-end;align-items:flex-end}'+
    '.cxg-who{font-size:11px;color:var(--g-ink3);padding:0 4px;display:flex;align-items:center;gap:6px}'+
    '.cxg-who b{color:var(--g-ink);font-weight:600}'+
    '.cxg-badge{font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:1px 6px;border-radius:4px;background:var(--g-bg);border:1px solid var(--g-line);color:var(--g-ink2)}'+
    '.cxg-badge.client{background:var(--g-acc);border-color:var(--g-acc);color:#fff}'+
    'html[data-theme="dark"] .cxg-badge.client{color:#0B0A08}'+
    '.cxg-badge.admin{color:var(--g-acc);border-color:var(--g-acc)}'+
    '.cxg-bub{padding:9px 13px;border-radius:14px;background:var(--g-bg);border:1px solid var(--g-line);line-height:1.5;white-space:pre-wrap;word-wrap:break-word}'+
    '.cxg-bub a{color:inherit;text-decoration:underline;text-underline-offset:2px;word-break:break-all}'+
    '.cxg-m.me .cxg-bub{background:var(--g-me);color:var(--g-mefg);border-color:var(--g-me);border-bottom-right-radius:4px}'+
    '.cxg-m:not(.me) .cxg-bub{border-bottom-left-radius:4px}'+
    '.cxg-m.client:not(.me) .cxg-bub{border-color:var(--g-acc);background:var(--g-accbg)}'+
    '.cxg-img{display:block;max-width:240px;max-height:220px;border-radius:10px;border:1px solid var(--g-line);cursor:zoom-in;object-fit:cover}'+
    '.cxg-comp{border-top:1px solid var(--g-line);background:var(--g-bg);padding:11px 13px}'+
    '.cxg-warn{font-size:12px;color:var(--g-bad);margin-bottom:7px;display:none;line-height:1.45}'+
    '.cxg-prev{display:none;align-items:center;gap:8px;margin-bottom:8px;font-size:12px;color:var(--g-ink2)}'+
    '.cxg-prev img{width:42px;height:42px;object-fit:cover;border-radius:7px;border:1px solid var(--g-line)}'+
    '.cxg-prev button{border:0;background:none;color:var(--g-ink3);cursor:pointer;font-size:15px}'+
    '.cxg-row{display:flex;gap:8px;align-items:flex-end}'+
    '.cxg-ta{flex:1;resize:none;min-height:40px;max-height:130px;padding:9px 12px;border:1px solid var(--g-line);border-radius:11px;background:var(--g-bg2);color:var(--g-ink);font:inherit;font-size:13.5px;outline:none;line-height:1.45}'+
    '.cxg-ta:focus{border-color:var(--g-acc)}'+
    '.cxg-att{width:40px;height:40px;flex:none;border:1px solid var(--g-line);border-radius:11px;background:var(--g-bg);color:var(--g-ink2);cursor:pointer;display:grid;place-items:center}'+
    '.cxg-send{height:40px;padding:0 15px;border:0;border-radius:11px;background:var(--g-me);color:var(--g-mefg);font:inherit;font-weight:600;font-size:13px;cursor:pointer}'+
    '.cxg-send[disabled]{opacity:.4;cursor:default}'+
    '.cxg-foot{font-size:10.5px;color:var(--g-ink3);margin-top:6px;line-height:1.4}'+
    '.cxg-empty{margin:auto;text-align:center;color:var(--g-ink3);padding:30px;max-width:380px;line-height:1.6}'+
    '.cxg-empty b{display:block;color:var(--g-ink);font-size:16px;margin-bottom:6px;font-weight:600}'+
    '.cxg-btn{border:1px solid var(--g-line);background:var(--g-bg);color:var(--g-ink);font:inherit;font-size:12px;font-weight:600;padding:7px 12px;border-radius:8px;cursor:pointer}'+
    '.cxg-btn.pri{background:var(--g-me);color:var(--g-mefg);border-color:var(--g-me)}'+
    '.cxg-sw{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--g-ink2);cursor:pointer;border:0;background:none;font-family:inherit}'+
    '.cxg-sw i{width:34px;height:20px;border-radius:999px;background:var(--g-line);position:relative;transition:background .2s}'+
    '.cxg-sw i:after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .2s;box-shadow:0 1px 2px rgba(0,0,0,.2)}'+
    '.cxg-sw.on i{background:var(--g-ok)}.cxg-sw.on i:after{transform:translateX(14px)}'+
    /* drawer */
    '.cxg-scrim{position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.28);opacity:0;transition:opacity .25s}'+
    '.cxg-scrim.on{opacity:1}'+
    '.cxg-drawer{position:fixed;top:0;right:0;bottom:0;z-index:9001;width:min(440px,100vw);box-shadow:-20px 0 60px -20px rgba(0,0,0,.35);'+
      'transform:translateX(100%);transition:transform .32s cubic-bezier(.16,1,.3,1);display:flex;flex-direction:column}'+
    '.cxg-drawer.on{transform:none}'+
    /* inline + admin */
    '.cxg-inline{height:calc(100vh - 230px);min-height:520px;border:1px solid var(--g-line);border-radius:16px;overflow:hidden}'+
    '.cxg-adm{display:grid;grid-template-columns:300px 1fr;height:calc(100vh - 230px);min-height:540px;border:1px solid var(--g-line);border-radius:16px;overflow:hidden;background:var(--g-bg)}'+
    '.cxg-list{border-right:1px solid var(--g-line);overflow-y:auto;background:var(--g-bg)}'+
    '.cxg-it{display:flex;flex-direction:column;gap:3px;width:100%;padding:12px 14px;border:0;border-bottom:1px solid var(--g-line);background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}'+
    '.cxg-it:hover{background:var(--g-bg2)}.cxg-it.on{background:var(--g-accbg)}'+
    '.cxg-it .t{display:flex;align-items:center;gap:6px;font-weight:600;font-size:13px}'+
    '.cxg-it .m{font-size:11.5px;color:var(--g-ink3)}.cxg-it .p{font-size:12px;color:var(--g-ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
    '.cxg-dot{min-width:17px;height:17px;padding:0 5px;border-radius:9px;background:var(--g-acc);color:#fff;font-size:10px;font-weight:700;display:inline-grid;place-items:center;margin-left:auto}'+
    '.cxg-chip{font-size:10px;font-weight:600;padding:1px 7px;border-radius:999px;border:1px solid var(--g-line);color:var(--g-ink3)}'+
    '.cxg-chip.on{color:var(--g-ok);border-color:currentColor}'+
    '.cxg-lb{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.82);display:grid;place-items:center;cursor:zoom-out;padding:24px}.cxg-lb img{max-width:100%;max-height:100%;border-radius:10px}'+
    '@media (max-width:820px){.cxg-adm{grid-template-columns:1fr}.cxg-adm .cxg-list{max-height:200px}.cxg-m{max-width:90%}}';
    document.head.appendChild(s);
  }

  async function rpc(sb,fn,args){var r=await sb.rpc(fn,args||{});if(r.error)throw new Error(errText(r.error));return r.data;}
  /* Realtime: on the real backend every chat subscribes to its table and refreshes the moment a row
     changes (row-level security decides what each person receives). Offline, or if the socket drops,
     the polling below keeps working; while the live connection is healthy it only polls every 30s. */
  function live(sb,table,filter,cb){
    var st={ok:false,off:function(){}};
    if(!sb||typeof sb.channel!=='function')return st;
    var t=null,fire=function(){clearTimeout(t);t=setTimeout(cb,150);};
    var cfg={event:'*',schema:'public',table:table}; if(filter)cfg.filter=filter;
    try{
      var ch=sb.channel('cxg-'+table+'-'+Math.random().toString(36).slice(2,8)).on('postgres_changes',cfg,fire)
        .subscribe(function(status){st.ok=status==='SUBSCRIBED';});
      st.off=function(){st.ok=false;try{sb.removeChannel(ch);}catch(e){}};
    }catch(e){}
    return st;
  }
  var LIVE_POLL_MS=30000;
  function status(sb,cid){return rpc(sb,'gc_status',{p_campaign_id:cid}).catch(function(){return {enabled:false,role:null};});}

  /* ---------- one room: messages + composer, polling ---------- */
  function room(host,opt){
    style();
    var sb=opt.sb,cid=opt.campaignId,timer=null,last=-1,shot=null,busy=false,role=opt.role||'creator',dead=false;
    host.innerHTML='<div class="cxg cxg-room">'+(opt.head||'')+
      '<div class="cxg-note">🕒<span><b>Messages disappear 12 hours after they’re sent</b> and are deleted for good. There is no backup, so save anything you need.</span></div>'+
      (role==='admin'?'<div class="cxg-bans" data-bans hidden></div>':'')+
      '<div class="cxg-msgs" data-msgs><div class="cxg-empty">Loading…</div></div>'+
      '<div class="cxg-paused" data-paused hidden>Clipency has paused this chat. You can read it, but not post right now.</div>'+
      '<div class="cxg-comp" data-comp><div class="cxg-warn" data-warn></div>'+
      '<div class="cxg-prev" data-prev><img alt=""><span>Image attached</span><button data-unshot title="Remove">×</button></div>'+
      '<div class="cxg-row"><button class="cxg-att" data-attach title="Attach an image (inspo, a frame to fix…)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-9 9"/></svg></button>'+
      '<input type="file" accept="image/*" data-file hidden>'+
      '<textarea class="cxg-ta" data-ta rows="1" placeholder="'+(role==='client'?'Message all creators: instructions, links, inspo…':role==='admin'?'Post as the Clipency team…':'Message the group…')+'"></textarea>'+
      '<button class="cxg-send" data-send disabled>Send</button></div>'+
      '<div class="cxg-foot">'+(role==='creator'?'Only Instagram, YouTube, Facebook and TikTok links. ':'Social links and Google Drive/Docs links only. ')+'No phone numbers, emails or outside chat apps'+(role==='admin'?'.':', and no payment talk (amounts, currencies, rates).')+'</div></div></div>';
    var R=host.firstChild, box=R.querySelector('[data-msgs]'), ta=R.querySelector('[data-ta]'), send=R.querySelector('[data-send]');
    var warn=R.querySelector('[data-warn]'), prev=R.querySelector('[data-prev]'), file=R.querySelector('[data-file]');
    function sync(){
      var bad=check(ta.value,role);
      warn.style.display=bad?'block':'none'; warn.textContent=bad?'Group chats can’t include '+bad+'.':'';
      send.disabled=!!bad||busy||(!ta.value.trim()&&!shot);
      ta.style.height='auto'; ta.style.height=Math.min(130,ta.scrollHeight)+'px';
    }
    function showShot(){prev.style.display=shot?'flex':'none'; if(shot)prev.querySelector('img').src=shot.url; sync();}
    async function pick(f){ if(!f)return; try{shot=await U().shrink(f);showShot();}catch(e){warn.style.display='block';warn.textContent=errText(e);} }
    ta.oninput=sync;
    ta.onkeydown=function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();if(!send.disabled)post();}};
    ta.onpaste=function(e){var it=[].slice.call((e.clipboardData||{}).items||[]).filter(function(x){return /^image\//.test(x.type);})[0];if(it){e.preventDefault();pick(it.getAsFile());}};
    R.querySelector('[data-attach]').onclick=function(){file.click();};
    file.onchange=function(){var f=file.files&&file.files[0];file.value='';pick(f);};
    R.querySelector('[data-unshot]').onclick=function(){shot=null;showShot();};
    send.onclick=post;

    function paint(list){
      var near=box.scrollHeight-box.scrollTop-box.clientHeight<80||last<0;
      box.innerHTML=list.length?list.map(function(m){
        if(m.sender_role==='system')return '<div class="cxg-sys">'+esc(m.body)+' · '+esc(ago(m.created_at))+'</div>';
        var badge=m.sender_role==='client'?'<span class="cxg-badge client">Client</span>':m.sender_role==='admin'?'<span class="cxg-badge admin">Clipency</span>':'<span class="cxg-badge">Creator</span>';
        var mod=role==='admin'?'<span class="cxg-mod"><button data-del="'+esc(m.id)+'" title="Delete this message for everyone">Delete</button>'+
          (m.sender_role==='creator'&&m.sender_id?'<button data-ban="'+esc(m.sender_id)+'" data-name="'+esc(m.sender_name)+'" title="Remove this creator from the chat">Ban</button>':'')+'</span>':'';
        return '<div class="cxg-m '+(m.mine?'me ':'')+esc(m.sender_role)+'">'+
          '<div class="cxg-who">'+(m.mine?'You':'<b>'+esc(m.sender_name)+'</b>')+badge+'<span>'+esc(when(m.created_at))+'</span>'+mod+'</div>'+
          (m.body?'<div class="cxg-bub">'+linkify(m.body)+'</div>':'')+
          (m.image_url?'<img class="cxg-img" src="'+esc(m.image_url)+'" alt="Image" data-zoom>':'')+'</div>';
      }).join(''):'<div class="cxg-empty"><b>No messages yet</b>'+(role==='client'?'Say hello and share the brief: what to post, links, inspo.':'The client’s instructions and links will show up here.')+'</div>';
      box.querySelectorAll('[data-del]').forEach(function(b){b.onclick=async function(){
        if(!confirm('Delete this message for everyone?'))return;
        try{await rpc(sb,'gc_delete_message',{p_message_id:b.dataset.del});}catch(e){alert(errText(e));} load(true);};});
      box.querySelectorAll('[data-ban]').forEach(function(b){b.onclick=async function(){
        if(!confirm('Remove '+b.dataset.name+' from this chat? They will no longer see it.'))return;
        try{await rpc(sb,'gc_ban',{p_campaign_id:cid,p_user_id:b.dataset.ban,p_banned:true});}catch(e){alert(errText(e));} load(true);};});
      box.querySelectorAll('[data-zoom]').forEach(function(i){i.onclick=function(){
        var lb=document.createElement('div');lb.className='cxg cxg-lb';lb.innerHTML='<img alt="">';lb.firstChild.src=i.src;lb.onclick=function(){lb.remove();};document.body.appendChild(lb);};});
      if(near)box.scrollTop=box.scrollHeight;
    }
    async function load(force){
      if(dead)return;
      try{
        var d=await rpc(sb,'gc_messages',{p_campaign_id:cid});
        var list=d.messages||[], sm=d.summary||{};
        if(opt.onSummary)opt.onSummary(sm);
        /* paused: only Clipency can post */
        var lock=!!sm.paused&&role!=='admin';
        R.querySelector('[data-paused]').hidden=!lock; R.querySelector('[data-comp]').style.display=lock?'none':'';
        var bans=R.querySelector('[data-bans]');
        if(bans){
          var bl=sm.banned||[]; bans.hidden=!bl.length;
          bans.innerHTML='Removed from this chat:'+bl.map(function(b){return '<span>'+esc(b.name)+'<button data-unban="'+esc(b.id)+'" title="Let them back in">×</button></span>';}).join('');
          bans.querySelectorAll('[data-unban]').forEach(function(x){x.onclick=async function(){
            try{await rpc(sb,'gc_ban',{p_campaign_id:cid,p_user_id:x.dataset.unban,p_banned:false});}catch(e){alert(errText(e));} load(true);};});
        }
        if(force||list.length!==last){paint(list);last=list.length;}
      }catch(e){box.innerHTML='<div class="cxg-empty"><b>Chat unavailable</b>'+esc(errText(e))+'</div>';last=-1;}
    }
    async function post(){
      var body=ta.value.trim(); if(check(body,role)||(!body&&!shot))return;
      busy=true; send.disabled=true; send.textContent='…';
      try{
        var img=shot?await U().upload(sb,'gc-'+cid,shot):null;
        await rpc(sb,'gc_post',{p_campaign_id:cid,p_body:body,p_image_url:img});
        ta.value=''; shot=null; showShot(); await load(true); ta.focus();
      }catch(e){warn.style.display='block';warn.textContent=errText(e);}
      busy=false; send.textContent='Send'; sync();
    }
    load(true);
    var lv1=live(sb,'campaign_chat_messages','campaign_id=eq.'+cid,function(){if(!dead)load(false);});
    var lv2=live(sb,'campaign_chats','campaign_id=eq.'+cid,function(){if(!dead)load(true);});
    var lastPoll=Date.now();
    timer=setInterval(function(){
      if(!document.body.contains(R)){clearInterval(timer);dead=true;lv1.off();lv2.off();return;}
      if(lv1.ok&&Date.now()-lastPoll<LIVE_POLL_MS)return;
      lastPoll=Date.now();
      if(!document.hidden&&R.offsetParent)load(false);
    },POLL_MS);
    window.addEventListener('storage',function(e){if(!dead&&/cx-offline-db/.test(e.key||''))load(false);});
    return {reload:function(){return load(true);},destroy:function(){dead=true;clearInterval(timer);lv1.off();lv2.off();}};
  }

  /* ---------- creator: right-hand drawer ---------- */
  function drawer(sb,cid,opt){
    style(); opt=opt||{};
    var old=document.querySelector('.cxg-drawer'); if(old){old.remove();var os=document.querySelector('.cxg-scrim');if(os)os.remove();}
    var scrim=document.createElement('div'); scrim.className='cxg-scrim';
    var dr=document.createElement('aside'); dr.className='cxg cxg-drawer'; dr.setAttribute('role','dialog'); dr.setAttribute('aria-label','Group chat');
    document.body.appendChild(scrim); document.body.appendChild(dr);
    var head='<div class="cxg-head"><div><div class="ti">Group chat</div><div class="su" data-sub>'+esc(opt.title||'')+'</div></div>'+
      '<span class="sp"></span><span class="cxg-live"><i></i>LIVE</span><button class="cxg-x" data-close aria-label="Close">×</button></div>';
    var r=room(dr,{sb:sb,campaignId:cid,role:'creator',head:head,onSummary:function(s){
      var el=dr.querySelector('[data-sub]'); if(el&&s)el.textContent=(opt.title||s.title)+' · '+s.member_count+' creators · '+s.client_name;
    }});
    function close(){scrim.classList.remove('on');dr.classList.remove('on');r.destroy();setTimeout(function(){scrim.remove();dr.remove();},320);document.removeEventListener('keydown',esc_);if(opt.onClose)opt.onClose();}
    function esc_(e){if(e.key==='Escape')close();}
    dr.querySelector('[data-close]').onclick=close; scrim.onclick=close; document.addEventListener('keydown',esc_);
    requestAnimationFrame(function(){scrim.classList.add('on');dr.classList.add('on');setTimeout(function(){var t=dr.querySelector('[data-ta]');if(t)t.focus();},340);});
    return {close:close};
  }

  /* ---------- client: inline room with the on/off switch ---------- */
  function mount(el,opt){
    style();
    var sb=opt.sb,cid=opt.campaignId,r=null;
    async function render(){
      var s=await status(sb,cid);
      if(!s.role){el.innerHTML='<div class="cxg"><div class="cxg-empty"><b>No group chat</b>Pick one of your campaigns first.</div></div>';return;}
      var sw='<button class="cxg-sw'+(s.enabled?' on':'')+'" data-sw title="Turn the group chat '+(s.enabled?'off':'on')+'"><i></i>Group chat '+(s.enabled?'on':'off')+'</button>';
      if(!s.enabled){
        if(r){r.destroy();r=null;}
        el.innerHTML='<div class="cxg cxg-inline" style="display:flex;background:var(--g-bg)"><div class="cxg-empty">'+
          '<b>Group chat is off</b>Turn it on to message every creator posting for <b style="display:inline;font-size:inherit">'+esc(s.title)+'</b> in one place: daily instructions, Drive links to assets, inspo. '+
          'Creators see it inside the campaign; contact details are blocked and Clipency can read along.'+
          '<div style="margin:14px auto 0;max-width:340px;padding:10px 12px;border:1px solid var(--g-line);border-radius:10px;background:var(--g-bg2);font-size:12.5px;color:var(--g-ink2)">'+
            '<b style="display:inline;font-size:inherit;color:var(--g-ink)">Free</b> for every campaign. Messages are deleted after '+(s.ttl_hours||12)+' hours; turn it off any time.</div>'+
          '<div style="margin-top:14px"><button class="cxg-btn pri" data-on>Turn on group chat</button></div></div></div>';
        el.querySelector('[data-on]').onclick=function(){toggle(true);};
        return;
      }
      el.innerHTML='<div class="cxg cxg-inline"></div>';
      var head='<div class="cxg-head"><div><div class="ti">'+esc(s.title)+'</div><div class="su" data-sub>'+s.member_count+' creators · you post as '+esc(s.client_name)+'</div></div>'+
        '<span class="sp"></span><span class="cxg-live"><i></i>LIVE</span>'+sw+'</div>';
      r=room(el.firstChild,{sb:sb,campaignId:cid,role:'client',head:head});
      el.querySelector('[data-sw]').onclick=function(){toggle(false);};
    }
    async function toggle(on){try{await rpc(sb,'gc_set_enabled',{p_campaign_id:cid,p_enabled:on});}catch(e){alert(errText(e));} render();}
    render();
    return {refresh:render};
  }

  /* ---------- creator: WhatsApp-style inbox of every campaign group they're in ---------- */
  function inbox(el,opt){
    style();
    var sb=opt.sb,cur=null,r=null,list=[],q='';
    if(!document.getElementById('cxg-inbox-style')){
      var st=document.createElement('style');st.id='cxg-inbox-style';
      st.textContent=
        '.cxg-ib{display:grid;grid-template-columns:340px 1fr;height:calc(100vh - 210px);min-height:540px;border:1px solid var(--g-line);border-radius:16px;overflow:hidden;background:var(--g-bg)}'+
        '.cxg-ib-side{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--g-line)}'+
        '.cxg-ib-top{padding:14px;border-bottom:1px solid var(--g-line)}'+
        '.cxg-ib-q{width:100%;padding:10px 14px 10px 36px;border:0;border-radius:999px;background:var(--g-bg2);color:var(--g-ink);font:inherit;font-size:13px;outline:none;'+
          'background-image:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 fill=%27none%27 stroke=%27%23999%27 stroke-width=%272%27 viewBox=%270 0 24 24%27%3E%3Ccircle cx=%2711%27 cy=%2711%27 r=%277%27/%3E%3Cpath d=%27m20 20-3.5-3.5%27/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:13px center}'+
        '.cxg-ib-list{overflow-y:auto;flex:1}'+
        '.cxg-ib-it{display:flex;gap:12px;align-items:center;width:100%;padding:12px 14px;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;border-radius:0}'+
        '.cxg-ib-it:hover{background:var(--g-bg2)}.cxg-ib-it.on{background:var(--g-accbg)}'+
        '.cxg-ib-av{width:46px;height:46px;border-radius:50%;flex:none;object-fit:cover;background:var(--g-me);color:var(--g-mefg);display:grid;place-items:center;font-weight:700;font-size:16px}'+
        '.cxg-ib-b{flex:1;min-width:0;border-bottom:1px solid var(--g-line);padding-bottom:12px;margin-bottom:-12px}'+
        '.cxg-ib-r1{display:flex;align-items:baseline;gap:8px}.cxg-ib-r1 b{flex:1;font-size:14.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
        '.cxg-ib-r1 span{font-size:11px;color:var(--g-ink3);flex:none}.cxg-ib-r1 span.new{color:var(--g-ok);font-weight:600}'+
        '.cxg-ib-r2{display:flex;align-items:center;gap:8px;margin-top:3px}.cxg-ib-r2 p{flex:1;margin:0;font-size:12.5px;color:var(--g-ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
        '.cxg-ib-n{min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--g-ok);color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center;flex:none}'+
        'html[data-theme="dark"] .cxg-ib-n{color:#0B0A08}'+
        '.cxg-ib-main{display:flex;flex-direction:column;min-height:0;min-width:0}'+
        '.cxg-ib-back{display:none;border:0;background:none;color:var(--g-ink2);font-size:20px;cursor:pointer;padding:0 6px 0 0}'+
        '@media (max-width:820px){.cxg-ib{grid-template-columns:1fr}.cxg-ib.reading .cxg-ib-side{display:none}.cxg-ib:not(.reading) .cxg-ib-main{display:none}.cxg-ib-back{display:inline-block}}';
      document.head.appendChild(st);
    }
    el.innerHTML='<div class="cxg cxg-ib"><aside class="cxg-ib-side"><div class="cxg-ib-top"><input class="cxg-ib-q" placeholder="Search group chats" data-q></div>'+
      '<div class="cxg-ib-list" data-list></div></aside><section class="cxg-ib-main" data-room><div class="cxg-empty">Pick a group chat to start talking.</div></section></div>';
    var root=el.firstChild, L=root.querySelector('[data-list]'), host=root.querySelector('[data-room]');
    root.querySelector('[data-q]').oninput=function(e){q=e.target.value.toLowerCase();paint();};
    function clock(d){
      if(!d)return '';var t=new Date(d),now=new Date();
      if(t.toDateString()===now.toDateString())return t.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).toLowerCase();
      var y=new Date(now);y.setDate(now.getDate()-1);
      return t.toDateString()===y.toDateString()?'Yesterday':t.toLocaleDateString('en-US',{weekday:'long'});
    }
    function paint(){
      var v=list.filter(function(c){return !q||(c.title+' '+c.client_name).toLowerCase().indexOf(q)>=0;});
      L.innerHTML=v.length?v.map(function(c){
        var av=c.icon_url?'<img class="cxg-ib-av" src="'+esc(c.icon_url)+'" alt="">':'<span class="cxg-ib-av">'+esc((c.title||'?')[0])+'</span>';
        var prev=c.last_preview?(c.last_sender?c.last_sender+': ':'')+c.last_preview:'No messages yet';
        return '<button class="cxg-ib-it'+(cur===c.campaign_id?' on':'')+'" data-id="'+esc(c.campaign_id)+'">'+av+
          '<span class="cxg-ib-b"><span class="cxg-ib-r1"><b>'+esc(c.title)+'</b><span'+(c.unread?' class="new"':'')+'>'+esc(clock(c.last_message_at))+'</span></span>'+
          '<span class="cxg-ib-r2"><p>'+esc(prev)+'</p>'+(c.unread?'<span class="cxg-ib-n">'+c.unread+'</span>':'')+'</span></span></button>';
      }).join(''):'<div class="cxg-empty" style="margin-top:30px"><b>'+(list.length?'No match':'No group chats yet')+'</b>'+
        (list.length?'Try another name.':'When a brand turns on the group chat for a campaign you’re in, it shows up here.')+'</div>';
      L.querySelectorAll('[data-id]').forEach(function(b){b.onclick=function(){open(b.dataset.id);};});
    }
    async function refresh(){
      try{list=await rpc(sb,'gc_list');}catch(e){list=[];}
      paint(); if(opt.onUnread)opt.onUnread(list.reduce(function(n,c){return n+(c.unread||0);},0));
    }
    function open(id){
      cur=id; root.classList.add('reading'); if(r){r.destroy();r=null;}
      var c=list.filter(function(x){return x.campaign_id===id;})[0]||{};
      host.innerHTML='';
      var av=c.icon_url?'<img class="cxg-ib-av" style="width:38px;height:38px" src="'+esc(c.icon_url)+'" alt="">':'<span class="cxg-ib-av" style="width:38px;height:38px">'+esc((c.title||'?')[0])+'</span>';
      var head='<div class="cxg-head"><button class="cxg-ib-back" data-back aria-label="Back">←</button>'+av+
        '<div><div class="ti">'+esc(c.title||'')+'</div><div class="su">'+esc(c.client_name||'')+' · '+(c.member_count||0)+' creators</div></div>'+
        '<span class="sp"></span><span class="cxg-live"><i></i>LIVE</span></div>';
      var box=document.createElement('div'); box.style.cssText='flex:1;min-height:0;display:flex;flex-direction:column'; host.appendChild(box);
      r=room(box,{sb:sb,campaignId:id,role:'creator',head:head});
      var bk=host.querySelector('[data-back]'); if(bk)bk.onclick=function(){root.classList.remove('reading');};
      setTimeout(refresh,400);   /* clears its unread badge */
      paint();
    }
    refresh().then(function(){ if(opt.focus)open(opt.focus); else if(list[0]&&window.innerWidth>820)open(list[0].campaign_id); });
    var lvI=live(sb,'campaign_chat_messages',null,function(){if(document.body.contains(L))refresh();}), lastI=Date.now();
    var t=setInterval(function(){if(!document.body.contains(L)){clearInterval(t);lvI.off();return;} if(lvI.ok&&Date.now()-lastI<LIVE_POLL_MS)return; lastI=Date.now(); if(!document.hidden&&L.offsetParent)refresh();},6000);
    return {refresh:refresh,open:open};
  }
  async function unread(sb){try{var l=await rpc(sb,'gc_list');return l.reduce(function(n,c){return n+(c.unread||0);},0);}catch(e){return 0;}}

  /* ---------- admin: every room ---------- */
  function admin(el,opt){
    style();
    var sb=opt.sb,cur=null,r=null,list=[];
    el.innerHTML='<div class="cxg cxg-adm"><div class="cxg-list" data-list></div><div data-room style="min-height:0;display:flex;flex-direction:column"><div class="cxg-empty">Pick a campaign to read its group chat.</div></div></div>';
    var L=el.querySelector('[data-list]'), host=el.querySelector('[data-room]');
    function paintList(){
      L.innerHTML=list.length?list.map(function(c){
        return '<button class="cxg-it'+(cur===c.campaign_id?' on':'')+'" data-id="'+esc(c.campaign_id)+'">'+
          '<span class="t">'+esc(c.title)+(c.unread?'<span class="cxg-dot">'+c.unread+'</span>':'')+'</span>'+
          '<span class="m">'+esc(c.client_name)+' · '+c.member_count+' creators · <span class="cxg-chip'+(c.enabled&&!c.paused?' on':'')+'">'+(c.paused?'Paused':c.enabled?'On':'Off')+'</span></span>'+
          (c.last_preview?'<span class="p">'+esc((c.last_sender?c.last_sender+': ':'')+c.last_preview)+'</span>':'')+'</button>';
      }).join(''):'<div class="cxg-empty">No campaigns yet.</div>';
      L.querySelectorAll('[data-id]').forEach(function(b){b.onclick=function(){open(b.dataset.id);};});
    }
    async function refresh(){try{list=await rpc(sb,'gc_list');}catch(e){list=[];}
      if(opt.campaignId)list=list.filter(function(c){return String(c.campaign_id)===String(opt.campaignId);});
      paintList(); if(opt.onCount)opt.onCount(list.filter(function(c){return c.enabled;}).length);}
    async function open(id){
      cur=id; paintList(); if(r){r.destroy();r=null;}
      var c=list.filter(function(x){return x.campaign_id===id;})[0]||{};
      host.innerHTML='';
      var head='<div class="cxg-head"><div><div class="ti">'+esc(c.title||'')+'</div><div class="su">'+esc(c.client_name||'')+' · '+(c.member_count||0)+' creators</div></div>'+
        '<span class="sp"></span>'+(c.enabled?'<span class="cxg-live"><i></i>LIVE</span>':'')+
        (c.enabled?'<button class="cxg-btn" data-pause>'+(c.paused?'▶ Resume chat':'⏸ Pause chat')+'</button>':'')+
        '<button class="cxg-sw'+(c.enabled?' on':'')+'" data-sw><i></i>'+(c.enabled?'On':'Off')+'</button></div>';
      if(!c.enabled){
        host.innerHTML='<div class="cxg" style="display:flex;flex-direction:column;height:100%">'+head+'<div class="cxg-empty"><b>Group chat is off</b>The client has not turned it on. You can turn it on for them.</div></div>';
      }else{
        var box=document.createElement('div'); box.style.cssText='flex:1;min-height:0;display:flex;flex-direction:column'; host.appendChild(box);
        r=room(box,{sb:sb,campaignId:id,role:'admin',head:head});
      }
      var pb=host.querySelector('[data-pause]');
      if(pb)pb.onclick=async function(){
        try{await rpc(sb,'gc_set_paused',{p_campaign_id:id,p_paused:!c.paused});}catch(e){alert(errText(e));return;}
        await refresh(); open(id);
      };
      host.querySelector('[data-sw]').onclick=async function(){
        try{await rpc(sb,'gc_set_enabled',{p_campaign_id:id,p_enabled:!c.enabled});}catch(e){alert(errText(e));return;}
        await refresh(); open(id);
      };
      refresh();
    }
    refresh().then(function(){var first=list.filter(function(c){return c.enabled;})[0]||(opt.campaignId&&list[0]); if(first)open(first.campaign_id);});
    var lvA=live(sb,'campaign_chat_messages',null,function(){if(document.body.contains(L))refresh();}), lastA=Date.now();
    var ta=setInterval(function(){if(!document.body.contains(L)){clearInterval(ta);lvA.off();return;} if(lvA.ok&&Date.now()-lastA<LIVE_POLL_MS)return; lastA=Date.now(); if(!document.hidden&&L.offsetParent)refresh();},8000);
    return {refresh:refresh};
  }

  window.CXGroupChat={status:status,drawer:drawer,mount:mount,inbox:inbox,admin:admin,unread:unread,check:check};
})();
