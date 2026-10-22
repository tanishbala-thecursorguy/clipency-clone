/* ============================================================
   CLIPENCY · APPEALS
   A ticket-style chat on a rejected clip, between its creator and
   the campaign's client, supervised by Clipency. Shared by the
   clipper dashboard, the client portal and the admin console.

     CXAppeals.mount(el, {sb, role:'creator'|'client'|'admin'})
       -> {refresh(), focus(appealId)}
     CXAppeals.open(sb, submissionId, firstMessage) -> {id, existing}
     CXAppeals.support(sb, question, topic) -> {id}   (a ticket to the Clipency team)
     mount option kinds: 'all' (default) | 'support' (people writing to Clipency) | 'clip' (clip appeals)
     CXAppeals.unread(sb) -> number
     CXAppeals.check(text) -> '' or what is not allowed

   Everything goes through SECURITY DEFINER rpcs (appeal_list,
   appeal_thread, appeal_open, appeal_post, appeal_resolve,
   appeal_unread), which decide who sees which thread and refuse
   contact details server-side. The checks here are only so people
   get told before they hit send.
   ============================================================ */
(function(){
  'use strict';
  if(window.CXAppeals)return;

  var POLL_MS=8000, IMG_MAX=1280, BUCKET='appeal-attachments';

  /* Keep everyone on-platform: no contact details, no outside chat. Mirrors the server. */
  var RULES=[
    [/[\w.+-]+@[\w-]+\.[\w.-]+/,'email addresses'],
    [/(?:\+?\d[\s().-]?){8,}/,'phone numbers'],
    [/\b(whats\s?app|telegram|signal app|snap\s?chat|wechat|discord(?:\.gg)?|wa\.me|t\.me|skype)\b/i,'other chat apps'],
    [/\b(dm me|text me|call me|my number|phone number|contact me (?:on|at)|message me on|reach me (?:on|at))\b/i,'requests to talk privately'],
    [/https?:\/\/(?!(?:www\.)?(?:instagram\.com|instagr\.am|tiktok\.com|vm\.tiktok\.com|youtube\.com|youtu\.be|clipency\.in)\b)\S+/i,'outside links (only Instagram, TikTok and YouTube links are allowed)']
  ];
  /* No payment talk between creators and clients (support chats with Clipency may discuss payouts). */
  var MONEY=/[$₹€£¥]|\b(rup+[aeiy]+\w*|dol+[aeo]r\w*)\b|\d[\d,.]*\s*(rs?|inr|usd)\b|\d\s*\/-|\b(rs\.?|inr|usd|eur|gbp|rupees?|dollars?|euros?|pounds?|bucks|paisa|lakhs?|lacs?|crores?|pay|paid|pays|paying|payment|payments|payout|payouts|money|cash|price|prices|pricing|rate|rates|rpm|cpm|fee|fees|salary|earn|earns|earned|earning|earnings|budget|budgets|invoice|invoices|upi|paypal|bank|transfer|tip|tips|bonus|bonuses|commission|compensation|per view|per video|per reel|per clip)\b/i;
  function check(t,allowMoney){
    for(var i=0;i<RULES.length;i++)if(RULES[i][0].test(t||''))return RULES[i][1];
    if(!allowMoney&&MONEY.test(t||''))return 'payment or money talk (amounts, currencies, rates or payouts)';
    return '';
  }

  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function ago(d){
    if(!d)return '';var m=Math.round((Date.now()-new Date(d))/6e4);
    if(m<1)return 'just now';if(m<60)return m+'m ago';var h=Math.round(m/60);if(h<24)return h+'h ago';
    var dd=Math.round(h/24);return dd<7?dd+'d ago':new Date(d).toLocaleDateString('en-US',{day:'numeric',month:'short'});
  }
  function when(d){return d?new Date(d).toLocaleString('en-US',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):'';}
  function initials(s){s=String(s||'?').replace(/^@/,'');return (s[0]||'?').toUpperCase();}
  function platName(p){return {instagram:'Instagram',tiktok:'TikTok',youtube:'YouTube'}[String(p||'').toLowerCase()]||p||'';}
  function roleLabel(r,mineRole){
    if(r==='system')return 'Clipency';
    if(r==='admin')return 'Clipency team';
    return r==='client'?'Client':'Creator';
  }
  function errText(e){return (e&&(e.message||e.error_description||e.msg))||String(e||'Something went wrong');}

  /* ---------- styles (scoped to .cxa; adapts to html[data-theme]) ---------- */
  function style(){
    if(document.getElementById('cxa-style'))return;
    var s=document.createElement('style');s.id='cxa-style';
    s.textContent=
    '.cxa{--a-bg:#FFFFFF;--a-bg2:#F6F3EE;--a-ink:#141210;--a-ink2:rgba(20,18,16,.62);--a-ink3:rgba(20,18,16,.4);--a-line:rgba(20,18,16,.1);'+
      '--a-acc:#8C6A45;--a-accbg:rgba(140,106,69,.1);--a-me:#141210;--a-mefg:#fff;--a-them:#F1EDE6;--a-bad:#B4544A;--a-ok:#3E8A52;'+
      'display:grid;grid-template-columns:320px 1fr;height:calc(100vh - 230px);min-height:540px;background:var(--a-bg);'+
      'border:1px solid var(--a-line);border-radius:16px;overflow:hidden;color:var(--a-ink);font-size:13.5px;text-align:left}'+
    'html[data-theme="dark"] .cxa{--a-bg:#161411;--a-bg2:#1D1A16;--a-ink:#EFEBE3;--a-ink2:rgba(239,235,227,.65);--a-ink3:rgba(239,235,227,.4);'+
      '--a-line:rgba(239,235,227,.09);--a-acc:#D8AA74;--a-accbg:rgba(216,170,116,.12);--a-me:#EFEBE3;--a-mefg:#0B0A08;--a-them:#24201B;--a-bad:#E0A196;--a-ok:#9DD6A8}'+
    '.cxa *{box-sizing:border-box}'+
    '.cxa-side{border-right:1px solid var(--a-line);display:flex;flex-direction:column;min-height:0;background:var(--a-bg)}'+
    '.cxa-sh{padding:14px;border-bottom:1px solid var(--a-line);display:flex;flex-direction:column;gap:10px}'+
    '.cxa-q{width:100%;padding:8px 11px;border:1px solid var(--a-line);border-radius:9px;background:var(--a-bg2);color:var(--a-ink);font:inherit;font-size:12.5px;outline:none}'+
    '.cxa-q:focus{border-color:var(--a-acc)}'+
    '.cxa-seg{display:flex;gap:3px;background:var(--a-bg2);border:1px solid var(--a-line);border-radius:9px;padding:3px}'+
    '.cxa-seg button{flex:1;border:0;background:none;color:var(--a-ink2);font:inherit;font-size:11.5px;font-weight:600;padding:5px 6px;border-radius:6px;cursor:pointer}'+
    '.cxa-seg button.on{background:var(--a-me);color:var(--a-mefg)}'+
    '.cxa-list{overflow-y:auto;flex:1;min-height:0}'+
    '.cxa-it{display:flex;gap:10px;width:100%;padding:12px 14px;border:0;border-bottom:1px solid var(--a-line);background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}'+
    '.cxa-it:hover{background:var(--a-bg2)}.cxa-it.on{background:var(--a-accbg)}'+
    '.cxa-av{width:32px;height:32px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:12px;font-weight:700;background:var(--a-me);color:var(--a-mefg)}'+
    '.cxa-it .b{min-width:0;flex:1}'+
    '.cxa-it .t{display:flex;width:100%;align-items:center;gap:6px;font-weight:600;font-size:13px}'+
    '.cxa-it .t span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'+
    '.cxa-it .m{display:block;font-size:11.5px;color:var(--a-ink3);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
    '.cxa-it .p{display:block;font-size:12px;color:var(--a-ink2);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
    '.cxa-grp{padding:9px 14px 7px;font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--a-acc);background:var(--a-bg2);border-bottom:1px solid var(--a-line);display:flex;justify-content:space-between}'+
    '.cxa-it .w{margin-left:auto;font-size:10.5px;color:var(--a-ink3);flex:none;font-weight:400}'+
    '.cxa-dot{min-width:17px;height:17px;padding:0 5px;border-radius:9px;background:var(--a-acc);color:#fff;font-size:10px;font-weight:700;display:inline-grid;place-items:center}'+
    '.cxa-chip{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:10.5px;font-weight:600;letter-spacing:.02em;white-space:nowrap}'+
    '.cxa-chip.open{background:rgba(214,160,70,.16);color:#A07020}.cxa-chip.approved{background:rgba(96,160,110,.15);color:var(--a-ok)}'+
    '.cxa-chip.upheld{background:var(--a-bg2);color:var(--a-ink2);border:1px solid var(--a-line)}'+
    'html[data-theme="dark"] .cxa-chip.open{color:#EBC27A}'+
    '.cxa-main{display:flex;flex-direction:column;min-height:0;min-width:0;background:var(--a-bg2)}'+
    '.cxa-mh{display:flex;align-items:center;gap:12px;padding:13px 18px;border-bottom:1px solid var(--a-line);background:var(--a-bg);flex-wrap:wrap}'+
    '.cxa-mh .ti{font-weight:600;font-size:14.5px}.cxa-mh .su{font-size:12px;color:var(--a-ink3)}'+
    '.cxa-mh .sp{flex:1}'+
    '.cxa-back{display:none;border:0;background:none;color:var(--a-ink2);font:inherit;font-size:18px;cursor:pointer;padding:0 6px 0 0}'+
    '.cxa-btn{border:1px solid var(--a-line);background:var(--a-bg);color:var(--a-ink);font:inherit;font-size:12px;font-weight:600;padding:7px 12px;border-radius:8px;cursor:pointer}'+
    '.cxa-btn:hover{border-color:var(--a-ink3)}.cxa-btn.pri{background:var(--a-me);color:var(--a-mefg);border-color:var(--a-me)}'+
    '.cxa-btn[disabled]{opacity:.45;cursor:default}'+
    '.cxa-msgs{flex:1;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:10px;min-height:0}'+
    '.cxa-clip{display:flex;gap:12px;align-items:flex-start;padding:13px 14px;background:var(--a-bg);border:1px solid var(--a-line);border-left:3px solid var(--a-acc);border-radius:12px;margin-bottom:6px}'+
    '.cxa-clip .lab{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--a-acc);font-weight:700}'+
    '.cxa-clip a{color:var(--a-ink);font-weight:600;word-break:break-all;text-decoration:none;border-bottom:1px solid var(--a-line)}'+
    '.cxa-clip a:hover{border-color:var(--a-acc)}'+
    '.cxa-clip .why{margin-top:8px;font-size:12.5px;color:var(--a-ink2);line-height:1.5}'+
    '.cxa-clip .why b{color:var(--a-bad);font-weight:600}'+
    '.cxa-sys{align-self:center;font-size:11.5px;color:var(--a-ink3);background:var(--a-bg);border:1px solid var(--a-line);padding:5px 12px;border-radius:999px;text-align:center;max-width:90%}'+
    '.cxa-m{max-width:72%;display:flex;flex-direction:column;gap:3px}'+
    '.cxa-m.me{align-self:flex-end;align-items:flex-end}'+
    '.cxa-m .who{font-size:10.5px;color:var(--a-ink3);padding:0 4px}'+
    '.cxa-m .who b{color:var(--a-ink2);font-weight:600}'+
    '.cxa-m .who .adm{color:var(--a-acc)}'+
    '.cxa-bub{padding:9px 13px;border-radius:14px;background:var(--a-bg);border:1px solid var(--a-line);line-height:1.5;white-space:pre-wrap;word-wrap:break-word}'+
    '.cxa-m.me .cxa-bub{background:var(--a-me);color:var(--a-mefg);border-color:var(--a-me);border-bottom-right-radius:4px}'+
    '.cxa-m:not(.me) .cxa-bub{border-bottom-left-radius:4px}'+
    '.cxa-m.admin:not(.me) .cxa-bub{border-color:var(--a-acc);background:var(--a-accbg)}'+
    '.cxa-img{display:block;max-width:260px;max-height:220px;border-radius:10px;border:1px solid var(--a-line);cursor:zoom-in;object-fit:cover}'+
    '.cxa-comp{border-top:1px solid var(--a-line);background:var(--a-bg);padding:12px 14px}'+
    '.cxa-warn{font-size:12px;color:var(--a-bad);margin-bottom:8px;display:none;line-height:1.45}'+
    '.cxa-prev{display:none;align-items:center;gap:8px;margin-bottom:8px;font-size:12px;color:var(--a-ink2)}'+
    '.cxa-prev img{width:44px;height:44px;object-fit:cover;border-radius:7px;border:1px solid var(--a-line)}'+
    '.cxa-prev button{border:0;background:none;color:var(--a-ink3);cursor:pointer;font-size:15px}'+
    '.cxa-row{display:flex;gap:8px;align-items:flex-end}'+
    '.cxa-ta{flex:1;resize:none;min-height:42px;max-height:140px;padding:10px 12px;border:1px solid var(--a-line);border-radius:11px;background:var(--a-bg2);color:var(--a-ink);font:inherit;font-size:13.5px;outline:none;line-height:1.45}'+
    '.cxa-ta:focus{border-color:var(--a-acc)}'+
    '.cxa-att{width:42px;height:42px;flex:none;border:1px solid var(--a-line);border-radius:11px;background:var(--a-bg);color:var(--a-ink2);cursor:pointer;display:grid;place-items:center}'+
    '.cxa-att:hover{color:var(--a-ink);border-color:var(--a-ink3)}'+
    '.cxa-send{height:42px;padding:0 16px;border:0;border-radius:11px;background:var(--a-me);color:var(--a-mefg);font:inherit;font-weight:600;font-size:13px;cursor:pointer}'+
    '.cxa-send[disabled]{opacity:.4;cursor:default}'+
    '.cxa-foot{font-size:10.5px;color:var(--a-ink3);margin-top:7px}'+
    '.cxa-closed{padding:14px;text-align:center;font-size:12.5px;color:var(--a-ink2);border-top:1px solid var(--a-line);background:var(--a-bg)}'+
    '.cxa-empty{margin:auto;text-align:center;color:var(--a-ink3);padding:30px;max-width:360px;line-height:1.6}'+
    '.cxa-empty b{display:block;color:var(--a-ink);font-size:16px;margin-bottom:6px;font-weight:600}'+
    '.cxa-lb{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.82);display:grid;place-items:center;cursor:zoom-out;padding:24px}'+
    '.cxa-lb img{max-width:100%;max-height:100%;border-radius:10px}'+
    '@media (max-width:820px){.cxa{grid-template-columns:1fr;height:calc(100vh - 170px)}'+
      '.cxa.reading .cxa-side{display:none}.cxa:not(.reading) .cxa-main{display:none}.cxa-back{display:inline-block}.cxa-m{max-width:88%}}';
    document.head.appendChild(s);
  }

  /* ---------- images: downscale, then storage (or inline when offline) ---------- */
  function shrink(file){
    return new Promise(function(res,rej){
      if(!/^image\//.test(file.type))return rej(new Error('Only images can be attached'));
      var fr=new FileReader();
      fr.onload=function(){
        var img=new Image();
        img.onload=function(){
          var k=Math.min(1,IMG_MAX/Math.max(img.width,img.height)),c=document.createElement('canvas');
          c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);
          c.getContext('2d').drawImage(img,0,0,c.width,c.height);
          c.toBlob(function(b){res({blob:b,url:c.toDataURL('image/jpeg',.82)});},'image/jpeg',.82);
        };
        img.onerror=function(){rej(new Error('Could not read that image'));};
        img.src=fr.result;
      };
      fr.onerror=function(){rej(new Error('Could not read that image'));};
      fr.readAsDataURL(file);
    });
  }
  async function upload(sb,appealId,shot){
    if(window.__CLIPENCY_OFFLINE__||!sb.storage)return shot.url;
    var path=appealId+'/'+Date.now()+'.jpg';
    var r=await sb.storage.from(BUCKET).upload(path,shot.blob,{contentType:'image/jpeg'});
    if(r.error)throw new Error('Could not upload the screenshot: '+r.error.message);
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  /* ---------- public helpers ---------- */
  async function open(sb,submissionId,body){
    var bad=check(body,false);
    if(bad)throw new Error('Appeals can’t include '+bad+'. Keep the conversation on Clipency.');
    var r=await sb.rpc('appeal_open',{p_submission_id:submissionId,p_body:body||''});
    if(r.error)throw new Error(errText(r.error));
    return r.data;
  }
  var TOPICS=['Tech issue','Payments & payouts','Running a campaign','My account','Something else'];
  async function support(sb,body,topic){
    var bad=check(body,true);
    if(bad)throw new Error('Messages can’t include '+bad+'.');
    if(!String(body||'').trim())throw new Error('Write your question first');
    var r=await sb.rpc('support_open',{p_body:body,p_subject:topic||''});
    if(r.error)throw new Error(errText(r.error));
    return r.data;
  }
  async function unread(sb){
    try{var r=await sb.rpc('appeal_unread');return r.error?0:Number(r.data)||0;}catch(e){return 0;}
  }

  /* ---------- the inbox ---------- */
  function mount(el,opt){
    style();
    var sb=opt.sb, role=opt.role||'creator', kinds=opt.kinds||'all';
    function inScope(a){
      if(opt.campaignId&&String(a.campaign_id)!==String(opt.campaignId))return false;
      return kinds==='all'||(kinds==='support'?a.kind==='support':a.kind!=='support');
    }
    var S={list:[],cur:null,thread:null,filter:'all',who:'all',q:'',shot:null,timer:null,busy:false,gone:''};
    el.innerHTML='<div class="cxa">'+
      '<aside class="cxa-side"><div class="cxa-sh">'+
        '<input class="cxa-q" placeholder="Search by creator, handle or campaign…" data-q>'+
        (role==='admin'&&kinds!=='clip'?'<div class="cxa-seg" data-who><button data-w="all" class="on">All</button><button data-w="creator">Creators</button><button data-w="client">Clients</button></div>':'')+
      '</div><div class="cxa-list" data-list></div></aside>'+
      '<section class="cxa-main" data-main></section></div>';
    var root=el.firstChild, listEl=root.querySelector('[data-list]'), mainEl=root.querySelector('[data-main]');

    root.querySelector('[data-q]').oninput=function(e){S.q=e.target.value.toLowerCase();paintList();};
    /* who raised it: clip appeals and creator support come from creators; client support from clients */
    function whoOf(a){return a.kind==='support'?(a.requester_role==='client'?'client':'creator'):'creator';}
    root.querySelectorAll('[data-who] button').forEach(function(b){b.onclick=function(){
      S.who=b.dataset.w;root.querySelectorAll('[data-who] button').forEach(function(x){x.classList.toggle('on',x===b);});paintList();};});

    function visible(){
      return S.list.filter(function(a){
        if(!inScope(a))return false;
        if(S.who!=='all'&&whoOf(a)!==S.who)return false;
        if(!S.q)return true;
        return (a.creator_name+' '+a.creator_handle+' '+a.campaign_title+' '+(a.client_name||'')).toLowerCase().indexOf(S.q)>=0;
      });
    }
    function isSup(a){return a.kind==='support';}
    function chip(a){
      if(isSup(a))return '<span class="cxa-chip upheld" style="margin-right:4px">Support</span>'+(a.status==='open'?'<span class="cxa-chip open">Open</span>':'<span class="cxa-chip approved">Resolved</span>');
      return a.status==='open'?'<span class="cxa-chip open">Open</span>'
        :a.outcome==='approved'?'<span class="cxa-chip approved">Clip approved</span>':'<span class="cxa-chip upheld">Rejection kept</span>';
    }
    function paintList(){
      var v=visible();
      if(opt.groupByCampaign)v=v.slice().sort(function(x,y){return String(x.campaign_title||'').localeCompare(String(y.campaign_title||''))||(x.last_message_at<y.last_message_at?1:-1);});
      var lastGrp=null;
      listEl.innerHTML=v.length?v.map(function(a){
        var grp='';
        if(opt.groupByCampaign&&a.campaign_title!==lastGrp){
          lastGrp=a.campaign_title;
          var n=v.filter(function(x){return x.campaign_title===lastGrp;}).length;
          grp='<div class="cxa-grp"><span>'+esc(lastGrp||'No campaign')+'</span><span>'+n+'</span></div>';
        }
        return grp+(function(){
        var mineSup=isSup(a)&&role!=='admin';
        var title=mineSup?'Clipency support':role==='creator'?a.campaign_title:(a.creator_name||a.creator_handle);
        var meta=isSup(a)?(role==='admin'?(a.requester_role==='client'?'Client':'Creator')+' · '+(a.subject||'Support'):a.subject)
          :role==='creator'?(a.client_name||'')+' · '+platName(a.platform):(a.creator_handle||'')+' · '+(a.campaign_title||'');
        var prev=(a.last_sender_role==='system'?'':roleLabel(a.last_sender_role)+': ')+(a.last_message_preview||'');
        return '<button class="cxa-it'+(S.cur===a.id?' on':'')+'" data-id="'+esc(a.id)+'">'+
          '<span class="cxa-av">'+esc(mineSup?'C':initials(role==='creator'?a.campaign_title:a.creator_name))+'</span>'+
          '<span class="b"><span class="t"><span>'+esc(title)+'</span>'+(a.unread?'<span class="cxa-dot">'+a.unread+'</span>':'')+
            '<span class="w">'+esc(ago(a.last_message_at))+'</span></span>'+
          '<span class="m">'+esc(meta)+'</span>'+
          '<span class="p">'+esc(prev)+'</span>'+
          '<span style="display:block;margin-top:6px">'+chip(a)+'</span></span></button>';
        })();
      }).join(''):'<div class="cxa-empty" style="margin-top:40px"><b>'+(S.list.filter(inScope).length?'Nothing here':kinds==='support'?'No open requests':'No appeals yet')+'</b>'+
        (S.list.filter(inScope).length?'Try another filter.':kinds==='support'?'When a creator or client writes to Clipency from Support → Appeal, it lands here.'
          :role==='creator'?'Appeal a rejected clip from Stats → Rejected, or ask the Clipency team anything from Support → Appeal.'
          :'When a creator appeals a rejected clip, the conversation shows up here.')+'</div>';
      listEl.querySelectorAll('[data-id]').forEach(function(b){b.onclick=function(){select(b.dataset.id);};});
    }
    function paintEmptyMain(){
      mainEl.innerHTML='<div class="cxa-empty"><b>Appeals</b>'+
        (role==='admin'?(kinds==='support'?'Creators and clients writing to Clipency: tech issues, payouts, running a campaign and more. Pick one to reply.'
          :'Clip appeals between creators and clients. Read along, step in as Clipency, or settle one yourself.')
          :role==='client'?'Creators can appeal a rejected clip and ask what to change. Pick a conversation to reply.'
          :'Ask the client about a rejected clip, or explain why it should count. Pick a conversation to continue.')+'</div>';
    }
    function paintThread(keepDraft){
      var t=S.thread; if(!t){paintEmptyMain();return;}
      var a=t.appeal, draft=keepDraft?(mainEl.querySelector('[data-ta]')||{}).value||'':'';
      var sup=isSup(a);
      var who=sup?(role==='admin'?a.creator_name+' · support':'Clipency support'):role==='creator'?a.campaign_title:(a.creator_name+' · '+a.creator_handle);
      var sub=sup?(role==='admin'?(a.requester_role==='client'?'Client':'Creator')+' · '+(a.creator_email||''):'Talking to the Clipency team')
        :role==='creator'?(a.client_name||'Client'):a.campaign_title;
      var canResolve=a.status==='open'&&(sup?role==='admin':(role==='client'||role==='admin'));
      var canWrite=a.status==='open'||role==='admin';
      mainEl.innerHTML=
        '<div class="cxa-mh"><button class="cxa-back" data-back aria-label="Back">←</button>'+
          '<div><div class="ti">'+esc(who)+'</div><div class="su">'+esc(sub)+' · opened '+esc(when(a.created_at))+'</div></div>'+
          '<span class="sp"></span>'+chip(a)+
          (canResolve&&sup?'<button class="cxa-btn pri" data-res="resolved" title="Close this support request">Mark resolved</button>':'')+
          (canResolve&&!sup?'<button class="cxa-btn" data-res="upheld" title="Close the appeal and keep the clip rejected">Keep rejected</button>'+
            '<button class="cxa-btn pri" data-res="approved" title="Approve the clip after all">Approve clip</button>':'')+
        '</div>'+
        '<div style="display:flex;align-items:center;gap:8px;padding:8px 18px;font-size:11.5px;line-height:1.4;color:var(--a-ink2);background:var(--a-accbg);border-bottom:1px solid var(--a-line)">🗑<span><b style="color:var(--a-ink)">This conversation is deleted for good once it’s settled</b>'+
          (sup?' (when Clipency marks it resolved).':' (clip approved or rejection kept).')+' There is no backup.</span></div>'+
        '<div class="cxa-msgs" data-msgs>'+
          (sup?'<div class="cxa-clip"><div style="min-width:0;flex:1"><div class="lab">Support request</div>'+
            '<div style="margin-top:5px;font-weight:600">'+esc(a.subject||'')+'</div>'+
            '<div class="why" style="margin-top:4px">'+(role==='admin'?'Opened by '+esc(a.creator_name)+' ('+esc(a.requester_role||'user')+'). Reply here; they get an email.':'The Clipency team replies here, usually within a few hours. You also get an email.')+'</div>'+
          '</div></div>':
          '<div class="cxa-clip"><div style="min-width:0;flex:1"><div class="lab">Appeal for this clip</div>'+
            '<div style="margin-top:5px"><a href="'+esc(a.clip_url)+'" target="_blank" rel="noopener noreferrer">'+esc(a.clip_url)+'</a></div>'+
            '<div class="su" style="margin-top:3px;font-size:11.5px;color:var(--a-ink3)">'+esc(a.creator_handle||'')+' · '+esc(platName(a.platform))+' · '+esc(a.campaign_title||'')+'</div>'+
            (a.reject_reason?'<div class="why"><b>Rejected:</b> '+esc(a.reject_reason)+'</div>':'')+
          '</div></div>')+
          t.messages.map(function(m){
            if(m.sender_role==='system')return '<div class="cxa-sys">'+esc(m.body)+' · '+esc(ago(m.created_at))+'</div>';
            var me=m.mine;
            return '<div class="cxa-m'+(me?' me':'')+(m.sender_role==='admin'?' admin':'')+'">'+
              '<div class="who">'+(me?'You':'<b'+(m.sender_role==='admin'?' class="adm"':'')+'>'+esc(m.sender_role==='admin'?'Clipency team':m.sender_name)+'</b> · '+esc(roleLabel(m.sender_role)))+
                ' · '+esc(when(m.created_at))+'</div>'+
              (m.body?'<div class="cxa-bub">'+esc(m.body)+'</div>':'')+
              (m.image_url?'<img class="cxa-img" src="'+esc(m.image_url)+'" alt="Screenshot" data-zoom>':'')+
            '</div>';
          }).join('')+
        '</div>'+
        (canWrite
          ?'<div class="cxa-comp"><div class="cxa-warn" data-warn></div>'+
            '<div class="cxa-prev" data-prev><img alt=""><span>Screenshot attached</span><button data-unshot title="Remove">×</button></div>'+
            '<div class="cxa-row">'+
              '<button class="cxa-att" data-attach title="Attach a screenshot"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l9.2-9.2a3.4 3.4 0 0 1 4.8 4.8l-9.2 9.2a1.7 1.7 0 0 1-2.4-2.4l8.5-8.5"/></svg></button>'+
              '<input type="file" accept="image/*" data-file hidden>'+
              '<textarea class="cxa-ta" data-ta rows="1" placeholder="'+(role==='admin'?'Reply as the Clipency team…':'Write a message…')+'"></textarea>'+
              '<button class="cxa-send" data-send disabled>Send</button></div>'+
            '</div>'
          :'<div class="cxa-closed">'+(a.outcome==='resolved'?'This support request is resolved. Need more help? Open a new one from Support.':'This appeal is closed'+(a.outcome==='approved'?': the clip was approved.':': the rejection was kept.'))+'</div>');

      var box=mainEl.querySelector('[data-msgs]'); box.scrollTop=box.scrollHeight;
      mainEl.querySelectorAll('[data-zoom]').forEach(function(i){i.onclick=function(){
        var lb=document.createElement('div');lb.className='cxa-lb';lb.innerHTML='<img alt="">';lb.firstChild.src=i.src;
        lb.onclick=function(){lb.remove();};document.body.appendChild(lb);};});
      var back=mainEl.querySelector('[data-back]'); if(back)back.onclick=function(){root.classList.remove('reading');};
      mainEl.querySelectorAll('[data-res]').forEach(function(b){b.onclick=function(){resolve(b.dataset.res,b);};});
      if(!canWrite)return;
      var ta=mainEl.querySelector('[data-ta]'), send=mainEl.querySelector('[data-send]'), warn=mainEl.querySelector('[data-warn]');
      var file=mainEl.querySelector('[data-file]'), prev=mainEl.querySelector('[data-prev]');
      var allowMoney=sup||role==='admin';
      function sync(){
        var bad=check(ta.value,allowMoney);
        warn.style.display=bad?'block':'none';
        warn.textContent=bad?'Appeals can’t include '+bad+'. Keep the conversation on Clipency.':'';
        send.disabled=!!bad||S.busy||(!ta.value.trim()&&!S.shot);
        ta.style.height='auto'; ta.style.height=Math.min(140,ta.scrollHeight)+'px';
      }
      function showShot(){
        prev.style.display=S.shot?'flex':'none';
        if(S.shot)prev.querySelector('img').src=S.shot.url;
        sync();
      }
      ta.value=draft; ta.oninput=sync;
      ta.onkeydown=function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();if(!send.disabled)post();}};
      mainEl.querySelector('[data-attach]').onclick=function(){file.click();};
      file.onchange=async function(){
        var f=file.files&&file.files[0]; file.value=''; if(!f)return;
        try{S.shot=await shrink(f);showShot();}catch(e){warn.style.display='block';warn.textContent=errText(e);}
      };
      mainEl.querySelector('[data-unshot]').onclick=function(){S.shot=null;showShot();};
      send.onclick=post;
      /* paste a screenshot straight from the clipboard */
      ta.onpaste=async function(e){
        var it=[].slice.call((e.clipboardData||{}).items||[]).filter(function(x){return /^image\//.test(x.type);})[0];
        if(!it)return; e.preventDefault();
        try{S.shot=await shrink(it.getAsFile());showShot();}catch(err){}
      };
      showShot();
      if(keepDraft&&document.activeElement===document.body)ta.focus();
    }
    async function post(){
      var ta=mainEl.querySelector('[data-ta]'), warn=mainEl.querySelector('[data-warn]'), send=mainEl.querySelector('[data-send]');
      var body=ta.value.trim(), bad=check(body,(S.thread&&S.thread.appeal.kind==='support')||role==='admin');
      if(bad||(!body&&!S.shot))return;
      S.busy=true; send.disabled=true; send.textContent='…';
      try{
        var img=S.shot?await upload(sb,S.cur,S.shot):null;
        var r=await sb.rpc('appeal_post',{p_appeal_id:S.cur,p_body:body,p_image_url:img});
        if(r.error)throw new Error(errText(r.error));
        S.shot=null; ta.value='';
        await loadThread(S.cur,false); await loadList();
        var t2=mainEl.querySelector('[data-ta]'); if(t2)t2.focus();
      }catch(e){
        warn.style.display='block'; warn.textContent=errText(e);
        send.textContent='Send'; send.disabled=false;
      }
      S.busy=false;
    }
    async function resolve(outcome,btn){
      btn.disabled=true;
      var r=await sb.rpc('appeal_resolve',{p_appeal_id:S.cur,p_outcome:outcome});
      if(r.error){alert(errText(r.error));btn.disabled=false;return;}
      S.cur=null; S.thread=null; root.classList.remove('reading');
      gone(outcome==='resolved'?'Resolved. The support conversation has been deleted.'
        :outcome==='approved'?'Clip approved. The appeal conversation has been deleted.':'Rejection kept. The appeal conversation has been deleted.');
      await loadList();
      if(opt.onResolved)opt.onResolved(outcome);
    }
    async function loadList(){
      var r=await sb.rpc('appeal_list');
      if(r.error){listEl.innerHTML='<div class="cxa-empty" style="margin-top:40px"><b>Could not load appeals</b>'+esc(errText(r.error))+'</div>';return;}
      S.list=Array.isArray(r.data)?r.data:[];
      paintList();
      if(opt.onUnread)opt.onUnread(S.list.filter(inScope).reduce(function(n,a){return n+(a.unread||0);},0));
    }
    function gone(text){ mainEl.innerHTML='<div class="cxa-empty"><b>Settled</b>'+esc(text)+'</div>'; }
    async function loadThread(id,keepDraft){
      var r=await sb.rpc('appeal_thread',{p_appeal_id:id});
      if(r.error){
        /* settled by the other side (or the clip was approved/rejected): the thread is gone for good */
        if(/not found/i.test(errText(r.error))){S.cur=null;S.thread=null;gone('This conversation was settled and has been deleted.');return;}
        mainEl.innerHTML='<div class="cxa-empty"><b>Could not open this appeal</b>'+esc(errText(r.error))+'</div>';return;
      }
      var before=S.thread&&S.thread.appeal.id===id?S.thread.messages.length:-1;
      S.thread=r.data;
      if(keepDraft&&before===S.thread.messages.length)return;   /* nothing new: leave the composer alone */
      paintThread(keepDraft);
    }
    async function select(id){
      S.cur=id; S.shot=null; root.classList.add('reading');
      var a=S.list.filter(function(x){return x.id===id;})[0];
      paintList();
      await loadThread(id,false);
      await loadList();   /* clears the unread dot */
    }
    /* Realtime: on the real backend a new message or a settled appeal arrives instantly (row-level
       security decides who receives what). Polling stays as the fallback; while live it slows to 30s. */
    var lv={ok:false,off:function(){}}, lastPoll=Date.now();
    if(opt.sb&&typeof opt.sb.channel==='function'){
      var lt=null,fire=function(){clearTimeout(lt);lt=setTimeout(async function(){
        if(!document.body.contains(root)||S.busy)return;
        await loadList(); if(S.cur)await loadThread(S.cur,true);
      },150);};
      try{
        var ch=opt.sb.channel('cxa-'+Math.random().toString(36).slice(2,8))
          .on('postgres_changes',{event:'*',schema:'public',table:'appeal_messages'},fire)
          .on('postgres_changes',{event:'*',schema:'public',table:'appeals'},fire)
          .subscribe(function(status){lv.ok=status==='SUBSCRIBED';});
        lv.off=function(){lv.ok=false;try{opt.sb.removeChannel(ch);}catch(e){}};
      }catch(e){}
    }
    function poll(){
      clearInterval(S.timer);
      S.timer=setInterval(async function(){
        if(!document.body.contains(root)){clearInterval(S.timer);lv.off();return;}
        if(document.hidden||!root.offsetParent||S.busy)return;
        if(lv.ok&&Date.now()-lastPoll<30000)return;
        lastPoll=Date.now();
        await loadList();
        if(S.cur)await loadThread(S.cur,true);
      },POLL_MS);
    }
    paintEmptyMain();
    var ready=loadList().then(function(){
      if(opt.focus)return select(opt.focus);
      var first=visible()[0]; if(first&&window.innerWidth>820)return select(first.id);
    });
    poll();
    return {
      refresh:function(){return loadList().then(function(){if(S.cur)return loadThread(S.cur,true);});},
      focus:function(id){return ready.then(function(){return loadList();}).then(function(){return select(id);});}
    };
  }

  window.CXAppeals={mount:mount,open:open,support:support,unread:unread,check:check,TOPICS:TOPICS,
    _util:{esc:esc,ago:ago,when:when,shrink:shrink,upload:upload,errText:errText,initials:initials}};
})();
