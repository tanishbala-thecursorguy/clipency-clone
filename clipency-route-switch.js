/* ============================================================
   CLIPENCY · WORKSPACE SWITCHER
   Three surfaces, one account: the clipper dashboard, the admin
   console and the client dashboard.

   The switcher only ever offers a door the signed-in account can
   actually open. Staff and client are asked of the database
   (cx_is_staff / cx_is_client) rather than guessed from the page,
   because that same answer is what the far side enforces — offering
   a link that bounces is worse than not offering it.

   Usage:
     CXRouteSwitch.mount({sb:sb, current:'admin', into:someEl});

   `current` is one of clipper | admin | client. `into` is the element
   the pill row is appended to. Everything else — styling, motion,
   the permission calls — is handled here.

   Motion is the transitions.dev tabs-sliding snippet: the pill's
   transform and width are written by JS, the tween is owned by CSS.
   ============================================================ */
(function(){
  'use strict';
  if(window.CXRouteSwitch)return;

  var ROUTES=[
    {id:'clipper',label:'Clipper',href:'/dashboard',
     ic:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none"/>'},
    {id:'admin',label:'Admin',href:'/admin',
     ic:'<path d="M12 3l7.5 3.4v5c0 4.4-3.1 8.3-7.5 9.6-4.4-1.3-7.5-5.2-7.5-9.6v-5z"/>'},
    {id:'client',label:'Client',href:'/home',
     ic:'<path d="M4 19V5M4 19h16"/><path d="m7 14 4-4 3 3 5-6"/>'}
  ];

  var CSS=''+
  '.cx-rs{position:relative;display:inline-flex;align-items:center;gap:3px;padding:3px;'+
    'border-radius:48px;background:var(--surface-2,rgba(127,127,127,.09));'+
    'border:1px solid var(--hair,rgba(127,127,127,.18));'+
    '--tabs-dur:250ms;--tabs-ease:cubic-bezier(0.22,1,0.36,1);}'+
  '.cx-rs a{position:relative;z-index:1;display:inline-flex;align-items:center;gap:6px;'+
    'height:28px;padding:4px 14px;border-radius:48px;text-decoration:none;white-space:nowrap;'+
    'font-size:12.5px;font-weight:600;color:var(--ink-55,rgba(127,127,127,.85));'+
    'transition:color var(--tabs-dur) var(--tabs-ease);}'+
  '.cx-rs a:hover,.cx-rs a[aria-selected="true"]{color:var(--ink,inherit);}'+
  '.cx-rs a svg{width:13px;height:13px;flex:none;}'+
  '.cx-rs-pill{position:absolute;top:3px;left:0;height:28px;width:0;border-radius:48px;'+
    'background:var(--surface,rgba(255,255,255,.9));z-index:0;pointer-events:none;'+
    'transform:translateX(0);box-shadow:0 1px 2px rgba(0,0,0,.14);'+
    'transition:transform var(--tabs-dur) var(--tabs-ease),width var(--tabs-dur) var(--tabs-ease);'+
    'will-change:transform,width;}'+
  '@media (prefers-reduced-motion:reduce){.cx-rs a,.cx-rs-pill{transition:none !important;}}';

  function style(){
    if(document.getElementById('cx-rs-css'))return;
    var el=document.createElement('style'); el.id='cx-rs-css'; el.textContent=CSS;
    document.head.appendChild(el);
  }

  async function allowed(sb,id){
    if(id==='clipper')return true;
    var fn=id==='admin'?'cx_is_staff':'cx_is_client';
    try{ var r=await sb.rpc(fn); return !!(r&&!r.error&&r.data); }
    catch(e){ return false; }
  }

  /* Off: each surface now has its own entry point (clipper sign-in, client
     sign-in, admin sign-in from the landing footer), so the cross-surface
     row is no longer shown. Flip to true to bring it back. */
  var ENABLED=false;

  async function mount(opt){
    if(!ENABLED)return null;
    opt=opt||{};
    var sb=opt.sb, into=opt.into, current=opt.current||'clipper';
    if(!sb||!into)return null;
    style();

    var show=[];
    for(var i=0;i<ROUTES.length;i++){
      var r=ROUTES[i];
      /* The surface you are standing on is always offered, so the row reads
         as "you are here, and here is where else you could be". */
      if(r.id===current||await allowed(sb,r.id))show.push(r);
    }
    /* One door is not a choice. */
    if(show.length<2)return null;

    var bar=document.createElement('div');
    bar.className='cx-rs'; bar.setAttribute('role','tablist');
    bar.setAttribute('aria-label','Switch workspace');
    bar.innerHTML='<span class="cx-rs-pill" aria-hidden="true"></span>'+
      show.map(function(r){
        return '<a role="tab" href="'+r.href+'" data-route="'+r.id+'" aria-selected="'+
          (r.id===current?'true':'false')+'">'+
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" '+
          'stroke-linecap="round" aria-hidden="true">'+r.ic+'</svg>'+r.label+'</a>';
      }).join('');
    into.appendChild(bar);

    var pill=bar.querySelector('.cx-rs-pill');
    var tabs=Array.prototype.slice.call(bar.querySelectorAll('a'));
    function moveTo(tab,animate){
      if(!tab)return;
      if(!animate){
        /* First paint and resize write the position with the transition
           suspended, or the pill animates in from translateX(0)/width 0. */
        var prev=pill.style.transition;
        pill.style.transition='none';
        pill.style.transform='translateX('+tab.offsetLeft+'px)';
        pill.style.width=tab.offsetWidth+'px';
        void pill.offsetWidth;
        pill.style.transition=prev;
      }else{
        pill.style.transform='translateX('+tab.offsetLeft+'px)';
        pill.style.width=tab.offsetWidth+'px';
      }
    }
    var active=function(){
      return tabs.filter(function(t){return t.getAttribute('aria-selected')==='true';})[0]||tabs[0];};
    tabs.forEach(function(t){t.addEventListener('mouseenter',function(){moveTo(t,true);});});
    bar.addEventListener('mouseleave',function(){moveTo(active(),true);});
    requestAnimationFrame(function(){moveTo(active(),false);});
    window.addEventListener('resize',function(){moveTo(active(),false);});
    return bar;
  }

  window.CXRouteSwitch={mount:mount,routes:ROUTES};
})();
