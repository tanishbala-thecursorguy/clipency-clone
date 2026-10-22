/* ============================================================
   CLIPENCY — interactive portal tour
   Spotlight + card walkthrough across pages.
   Resumes across navigation via sessionStorage['clipency-tour-step'].
   First visit to Home auto-offers the tour (localStorage['clipency-tour-seen']).
   Relaunch anytime from the "?" button in the topbar.
   ============================================================ */
window.CLIPTOUR = (function(){

  var STEPS = [
    {page:'home.html', center:true,
     title:'Welcome to your Clipency portal',
     text:'This is where you run campaigns, track every clip, and manage your budget. Take a 60-second tour — you can leave at any time.'},

    {page:'home.html', sel:'#homeStats',
     title:'Your numbers at a glance',
     text:'Campaigns running, views delivered, campaign spend, and your wallet balance — always live, across every campaign.'},

    {page:'home.html', sel:'#camps .camp',
     title:'Your campaigns',
     text:'Each card is one campaign — status, views, clips, and how much budget it has used. Click a card to open its full dashboard with clips, analytics, and billing.'},

    {page:'home.html', sel:'#newCampBtn',
     title:'Launch a new campaign',
     text:'This opens the campaign brief. Budget is reserved from your wallet, and our team reviews every brief before it goes live.'},

    {page:'home.html', sel:'#campVeil .modal', before:'openCamp', after:'closeCamp', place:'right',
     title:'The campaign brief',
     text:'Banner, title, category, budget, RPM, platforms, requirements for clippers, your content access link, and content guidelines — everything the network needs to start clipping.'},

    {page:'budget.html', sel:'#statBalance',
     title:'Your wallet',
     text:'The Budget section is where money lives. Your balance funds new campaigns; unspent budget always returns here.'},

    {page:'budget.html', sel:'#addFundsBtn',
     title:'Adding funds',
     text:'Self-serve top-up is coming soon. For now your Clipency manager credits your wallet directly — message us and it’s applied the same day. Every deposit and allocation shows in the budget history on the right.'},

    {page:'budget.html', sel:'#weeklyPanel',
     title:'Weekly spend digest',
     text:'Every 7 days you can see exactly how much budget each campaign exhausted, and the views that spend delivered.'},

    {page:'profile.html', sel:'#profilePanel',
     title:'Your profile',
     text:'Set your display name, email, and profile picture. This is how you appear across the portal.'},

    {page:'profile.html', sel:'#pwPanel',
     title:'Password & security',
     text:'Change your password here whenever you need to.'},

    {page:'profile.html', sel:'#contactVeil .modal', before:'openContact', after:'closeContact', place:'left',
     title:'Contact your manager',
     text:'Email us or open a Discord ticket — your Clipency manager is one tap away from every page.'},

    {page:'campaign.html', sel:'.stats', before:'activateTP',
     title:'Inside a campaign',
     text:'Open any campaign and you get its own dashboard — views delivered, live clips, budget used, and spend, plus Clips Feed, Analytics, Billing, and Creators in the sidebar.'},

    {page:'campaign.html', sel:'.snav a[data-action="export"]', place:'right',
     title:'Export your report',
     text:'One click builds a polished Excel report — summary, every clip, creators, and billing — ready to share or import into Google Sheets.'},

    {page:'campaign.html', center:true, last:true,
     title:'You’re all set',
     text:'That’s the whole portal. Replay this tour anytime with the “?” button in the top bar. Now go launch something.'}
  ];

  /* here() returns the page name WITHOUT .html, because vercel's cleanUrls
     serves /home rather than /home.html. Comparing against 'home.html' here is
     what stopped the tour ever auto-offering on the deployed site. */
  var HOME = 'home';

  var KEY = 'clipency-tour-step';
  var SEEN = 'clipency-tour-seen';
  var cur = -1, hole = null, card = null, blocker = null;

  /* ------------------------------------------------------------------
     DEMO MODE

     A signed-in client can wander the portal and replay the tour at will.
     A demo visitor cannot: the tour is the entire experience. It starts
     automatically, cannot be skipped or closed, nothing behind it is
     clickable, and it ends on the request-access form rather than
     dropping the visitor into a dashboard that is not theirs.
     ------------------------------------------------------------------ */
  function isDemo(){
    try{
      if(/[?&]demo=1/.test(location.search)) return true;
      return sessionStorage.getItem('clipency-demo') === '1';
    }catch(e){ return false; }
  }

  /* Swallows every pointer event and key that could navigate. Sits under
     the tour card (z-index below it) and over everything else, so the only
     live control on the page is the tour's own Next button. */
  function ensureBlocker(){
    if(!isDemo() || blocker) return;
    blocker = document.createElement('div');
    blocker.id = 'demoBlocker';
    blocker.style.cssText = [
      'position:fixed','inset:0','z-index:9998','background:transparent',
      'cursor:not-allowed'
    ].join(';');
    ['click','mousedown','mouseup','dblclick','contextmenu','touchstart','touchend','wheel']
      .forEach(function(ev){
        blocker.addEventListener(ev, function(e){
          e.preventDefault(); e.stopPropagation();
        }, {passive:false});
      });
    document.body.appendChild(blocker);

    /* Keyboard is a second way out: Tab into a nav link and press Enter.
       Block anything that could move the page, but leave the tour usable. */
    document.addEventListener('keydown', function(e){
      if(!isDemo()) return;
      var inCard = card && card.contains(e.target);
      if(inCard && (e.key === 'Enter' || e.key === ' ')) return;
      if(e.key === 'Tab' || e.key === 'Enter' || e.key === ' ' || e.key === 'Escape'){
        e.preventDefault(); e.stopPropagation();
      }
    }, true);
  }

  /* Compare pages without the extension.

     vercel.json sets cleanUrls:true, so the deployed URL is /campaign, not
     /campaign.html. here() used to return 'campaign' and compare it against
     STEPS entries like 'campaign.html' — never equal, so the tour would try to
     navigate to the step's page on every tick. It only appeared to work
     locally, where a plain static server keeps the .html. Normalise both
     sides instead. */
  function norm(p){
    return String(p || '').split('/').pop().replace(/\.html$/, '') || 'home';
  }
  function here(){
    return norm(location.pathname);
  }

  /* ---------- before/after hooks ---------- */
  var HOOKS = {
    openCamp: function(){
      var b = document.getElementById('newCampBtn');
      if(b && !document.getElementById('campVeil').classList.contains('show')) b.click();
    },
    closeCamp: function(){
      var v = document.getElementById('campVeil');
      if(v) v.classList.remove('show');
    },
    openContact: function(){
      if(window.CLIPSHELL) CLIPSHELL.openContact();
    },
    closeContact: function(){
      var v = document.getElementById('contactVeil');
      if(v) v.classList.remove('show');
    },
    /* Was CLIPDB.setActive('tp') — the hardcoded seed id. Campaign ids are
       real uuids now (and 'demo-campaign' in demo), so that call matched
       nothing and the campaign step opened an empty dashboard. Activate
       whichever campaign the store actually holds. */
    activateTP: function(){
      if(!window.CLIPDB) return;
      var list = CLIPDB.campaigns ? CLIPDB.campaigns() : [];
      if(list.length) CLIPDB.setActive(list[0].id);
    }
  };

  /* ---------- UI ---------- */
  function ensureEls(){
    if(!hole){
      hole = document.createElement('div');
      hole.className = 'tour-hole';
      document.body.appendChild(hole);
    }
    if(!card){
      card = document.createElement('div');
      card.className = 'tour-card';
      card.style.zIndex = '10000';        // above the demo blocker
      document.body.appendChild(card);
    }
  }

  function destroy(){
    if(hole){ hole.remove(); hole = null; }
    if(card){ card.remove(); card = null; }
    removeEventListener('resize', reposition);
  }

  function stop(done){
    var s = STEPS[cur];
    if(s && s.after && HOOKS[s.after]) HOOKS[s.after]();
    try{
      sessionStorage.removeItem(KEY);
      localStorage.setItem(SEEN, '1');
    }catch(e){}
    cur = -1;

    /* Demo ends at the request-access form, never back in the dashboard.
       The demo flag is cleared on the way out so a prospect who returns
       later gets the sign-in page rather than a stale sample dashboard. */
    if(isDemo()){
      try{ sessionStorage.removeItem('clipency-demo'); }catch(e){}
      destroy();
      if(blocker){ blocker.remove(); blocker = null; }
      location.href = './client-signin.html#lead';
      return;
    }

    destroy();
    if(done && window.CLIPSHELL) CLIPSHELL.toast('Tour finished — the “?” button replays it anytime.');
  }

  function reposition(){
    if(cur < 0) return;
    var s = STEPS[cur];
    if(s.center || !s.sel) return;
    var el = document.querySelector(s.sel);
    if(el) place(el, s);
  }

  function place(el, s){
    var r = el.getBoundingClientRect();
    var pad = 8;
    hole.style.display = '';
    hole.style.left = (r.left - pad) + 'px';
    hole.style.top = (r.top - pad) + 'px';
    hole.style.width = (r.width + pad*2) + 'px';
    hole.style.height = (r.height + pad*2) + 'px';

    var cw = Math.min(360, innerWidth - 36), ch = card.offsetHeight || 200;
    var x, y;
    if(s.place === 'right' && r.right + cw + 28 < innerWidth){
      x = r.right + 20; y = Math.max(18, Math.min(innerHeight - ch - 18, r.top));
    } else if(s.place === 'left' && r.left - cw - 28 > 0){
      x = r.left - cw - 20; y = Math.max(18, Math.min(innerHeight - ch - 18, r.top));
    } else if(r.bottom + ch + 30 < innerHeight){
      x = Math.max(18, Math.min(innerWidth - cw - 18, r.left)); y = r.bottom + 18;
    } else {
      x = Math.max(18, Math.min(innerWidth - cw - 18, r.left)); y = Math.max(18, r.top - ch - 18);
    }
    card.style.left = x + 'px';
    card.style.top = y + 'px';
    card.style.transform = 'none';
  }

  function render(){
    var s = STEPS[cur];
    var demo = isDemo();
    ensureEls();
    ensureBlocker();
    var total = STEPS.length;
    var title = s.title, text = s.text;
    if(demo && cur === 0){
      title = 'A guided tour of the client dashboard';
      text  = 'This is the dashboard your clients get. Walk through it step by step — ' +
              'the numbers below are sample data, not a real campaign.';
    }
    if(demo && s.last){
      title = 'That is the whole dashboard';
      text  = 'Every campaign you run with Clipency reports here — clips, views, ' +
              'spend and creators, updated automatically. Tell us about your ' +
              'campaign and we will set your own dashboard up.';
    }
    card.innerHTML =
      '<span class="t-step">Step ' + (cur + 1) + ' of ' + total + '</span>' +
      '<h4>' + title + '</h4>' +
      '<p>' + text + '</p>' +
      '<div class="tour-dots">' + STEPS.map(function(_, i){
        return '<i' + (i === cur ? ' class="on"' : '') + '></i>';
      }).join('') + '</div>' +
      '<div class="t-actions">' +
        /* No skip in demo: the tour is the demo. Leaving it half-way would
           strand a visitor in a dashboard they cannot use. */
        (demo ? '<span class="t-skip"></span>'
              : '<button class="t-skip" type="button">' + (s.last ? '' : 'Skip tour') + '</button>') +
        (cur > 0 && !s.last ? '<button class="btn btn-line t-back" type="button">Back</button>' : '') +
        '<button class="btn t-next" type="button">' +
          (s.last ? (demo ? 'Get full access &#8594;' : 'Finish')
                  : cur === 0 ? 'Start tour' : 'Next') +
        '</button>' +
      '</div>';

    card.querySelector('.t-next').addEventListener('click', function(){ go(cur + 1); });
    var back = card.querySelector('.t-back');
    if(back) back.addEventListener('click', function(){ go(cur - 1); });
    var skip = card.querySelector('button.t-skip');
    if(skip) skip.addEventListener('click', function(){ stop(false); });

    if(s.center || !s.sel){
      hole.style.display = 'none';
      /* dim everything with the card's own shadow trick */
      hole.style.display = '';
      hole.style.left = '50%'; hole.style.top = '38%';
      hole.style.width = '0'; hole.style.height = '0';
      card.style.left = '50%'; card.style.top = '50%';
      card.style.transform = 'translate(-50%,-50%)';
      return;
    }
    var el = document.querySelector(s.sel);
    if(!el){ go(cur + 1); return; }
    try{ el.scrollIntoView({block:'center', behavior:'smooth'}); }catch(e){ el.scrollIntoView(); }
    setTimeout(function(){ place(el, s); }, 380);
  }

  function go(n){
    var prev = STEPS[cur];
    if(prev && prev.after && HOOKS[prev.after]) HOOKS[prev.after]();
    if(n >= STEPS.length){ stop(true); return; }
    if(n < 0) n = 0;
    var s = STEPS[n];
    if(norm(s.page) !== here()){
      /* run cross-page prep (e.g. select campaign) before navigating */
      if(s.before && HOOKS[s.before]) HOOKS[s.before]();
      try{ sessionStorage.setItem(KEY, String(n)); }catch(e){}
      location.href = './' + s.page;
      return;
    }
    cur = n;
    if(s.before && HOOKS[s.before]) HOOKS[s.before]();
    setTimeout(render, s.before ? 420 : 0);
  }

  function start(){
    try{ localStorage.setItem(SEEN, '1'); }catch(e){}
    var first = 0;
    /* if launched from a non-home page, find the first step for this page */
    if(here() !== 'home.html'){
      for(var i = 0; i < STEPS.length; i++){
        if(norm(STEPS[i].page) === here()){ first = i; break; }
      }
    }
    addEventListener('resize', reposition);
    go(first);
  }

  /* ---------- resume / first-visit ---------- */
  function boot(){
    var resume = null;
    try{ resume = sessionStorage.getItem(KEY); }catch(e){}

    /* Demo: the tour is mandatory, so it starts on its own and the blocker
       goes up immediately — before a visitor has a chance to click a nav
       link while the tour is still waiting on its 900ms timer. */
    if(isDemo()){
      ensureBlocker();
      addEventListener('resize', reposition);
      var at = 0;
      if(resume !== null){
        try{ sessionStorage.removeItem(KEY); }catch(e){}
        var r = parseInt(resume, 10);
        if(STEPS[r] && norm(STEPS[r].page) === here()) at = r;
      }
      setTimeout(function(){ go(at); }, at ? 450 : 700);
      return;
    }
    if(resume !== null){
      try{ sessionStorage.removeItem(KEY); }catch(e){}
      var n = parseInt(resume, 10);
      if(STEPS[n] && norm(STEPS[n].page) === here()){
        addEventListener('resize', reposition);
        setTimeout(function(){ go(n); }, 450);
        return;
      }
    }
    /* fresh login from the landing page → always show the tour */
    var fresh = null;
    try{ fresh = sessionStorage.getItem('clipency-fresh-login'); }catch(e){}
    if(fresh && here() === HOME){
      try{ sessionStorage.removeItem('clipency-fresh-login'); }catch(e){}
      addEventListener('resize', reposition);
      setTimeout(function(){ go(0); }, 900);
      return;
    }
    /* force via URL: home.html?tour */
    if(/[?&]tour/.test(location.search) && here() === HOME){
      addEventListener('resize', reposition);
      setTimeout(function(){ go(0); }, 900);
      return;
    }
    var seen = null;
    try{ seen = localStorage.getItem(SEEN); }catch(e){}
    if(!seen && here() === HOME){
      addEventListener('resize', reposition);
      setTimeout(function(){ go(0); }, 900);
    }
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  return { start:start, stop:stop };
})();
