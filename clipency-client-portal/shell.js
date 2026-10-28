/* ============================================================
   CLIPENCY — dashboard shell (sidebar, topbar, theme, guard)
   Each page calls CLIPSHELL.init('<pageKey>') after including:
     <div class="shell">
       <div id="side"></div>
       <div class="main">
         <div id="topbar"></div>
         <main class="content"> ...page content... </main>
       </div>
     </div>
   ============================================================ */
/* remember this dashboard so opening clipency.in comes straight back here (see launch-site build.py RESUME) */
try{ localStorage.setItem('cx-last-portal', location.pathname + location.search); }catch(e){}

window.CLIPSHELL = (function(){

  /* ---------- icons shared between contexts ---------- */
  var IC = {
    home:'<path d="M3 10.2 12 3l9 7.2"/><path d="M5 8.8V21h14V8.8"/><path d="M9.5 21v-6h5v6"/>',
    budget:'<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><path d="M7 15h4"/>',
    profile:'<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5c.8-4 3.9-6.2 7.5-6.2s6.7 2.2 7.5 6.2"/>',
    contact:'<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 7 8.5 6 8.5-6"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/>',
    back:'<path d="M15 5l-7 7 7 7"/>'
  };

  /* Portal context — Home, Budget, account pages */
  var HOME_PAGES = [
    {key:'home',    href:'home.html',    label:'Home',          group:'Portal', badge:true, icon:IC.home},
    {key:'budget',  href:'budget.html',  label:'Budget',        group:'Portal', icon:IC.budget},
    {key:'profile', href:'profile.html', label:'Profile',       group:'Account', icon:IC.profile},
    {key:'contact', href:'#',            label:'Contact Admin', group:'Account', action:'contact', icon:IC.contact},
    {key:'settings',href:'#',            label:'Settings',      group:'Account', soon:true, icon:IC.settings}
  ];

  /* Campaign context — inside a selected campaign */
  var PAGES = [
    {key:'back',      href:'home.html',      label:'Back to Home',    group:'Portal', icon:IC.back},
    {key:'overview',  href:'dashboard.html', label:'Overview',        group:'Campaign',
     icon:'<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>'},
    {key:'review',    href:'campaign.html?view=review', label:'Review', group:'Campaign',
     icon:'<path d="M9 11.5l2.2 2.2L15.5 9.4"/><rect x="3.5" y="3.5" width="17" height="17" rx="4"/>'},
    {key:'clips',     href:'clips.html',     label:'Clips Feed',      group:'Campaign',
     icon:'<path d="M15.6 8.4 21 3M21 3h-4.5M21 3v4.5"/><path d="M20 13v5a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h5"/>'},
    {key:'analytics', href:'analytics.html', label:'Analytics',       group:'Campaign',
     icon:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'},
    {key:'billing',   href:'billing.html',   label:'Spend & Billing', group:'Campaign',
     icon:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M9.5 10a2.5 2 0 0 1 5 0c0 2.6-5 1.4-5 4a2.5 2 0 0 0 5 0"/>'},
    {key:'creators',  href:'creators.html',  label:'Creators',        group:'Campaign',
     icon:'<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c.6-3.4 2.8-5.2 5.5-5.2s4.9 1.8 5.5 5.2"/><path d="M16 4.8a3.2 3.2 0 0 1 0 6.4M17.5 14.9c2 .6 3.6 2.2 4 4.6"/>'},
    {key:'export',    href:'#',              label:'Export Report',   group:'Account', action:'export',
     icon:'<path d="M12 3v11.5M7.5 10.5 12 15l4.5-4.5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'},
    {key:'contact',   href:'#',              label:'Contact Admin',   group:'Account', action:'contact', icon:IC.contact}
  ];

  var HOME_KEYS = ['home','budget','profile'];

  var BRAND =
    /* was ./creator-dashboard-landing.html — that file does not exist in this
       folder, so the sidebar logo 404'd. The landing page here is landing.html,
       served at / via the rewrite in vercel.json. */
    '<a class="brand" href="./"><img class="cx-logo" src="./Clipencylogo.png" alt="Clipency"></a>';

  /* The logo is white ink on transparent, so it is invisible on a light
     background. brightness(0) paints it black while keeping the alpha edges
     clean; invert() would also lift the transparent pixels and leave a halo.
     Injected once from here so all nine portal pages get it without touching
     nine stylesheets. */
  (function logoCss(){
    if(document.getElementById('cx-logo-css')) return;
    var st = document.createElement('style');
    st.id = 'cx-logo-css';
    st.textContent =
      '.cx-logo{height:22px;width:auto;display:block;filter:brightness(0);' +
        'transition:filter .3s ease}' +
      '[data-theme="dark"] .cx-logo{filter:none}';
    document.head.appendChild(st);
  })();

  function pagesFor(active){
    return HOME_KEYS.indexOf(active) > -1 ? HOME_PAGES : PAGES;
  }

  function sidebar(active){
    var html = BRAND, group = '';
    pagesFor(active).forEach(function(p){
      if(p.group !== group){
        if(group) html += '</nav>';
        html += '<span class="side-label">' + p.group + '</span><nav class="snav">';
        group = p.group;
      }
      var badge = '';
      if(p.badge && window.CLIPDB){
        var n = CLIPDB.portfolio().running;
        badge = ' <span class="navcount" title="' + n + ' running campaign' + (n===1?'':'s') + '">' + n + '</span>';
      }
      /* Clips waiting for this client's review on the open campaign. */
      if(p.key === 'review' && window.CLIPENCY && CLIPENCY.pending && CLIPENCY.pending.length){
        var q = CLIPENCY.pending.length;
        badge = ' <span class="navcount" title="' + q + ' clip' + (q===1?'':'s') + ' waiting for your review">' + q + '</span>';
      }
      html += '<a href="' + p.href + '"' + (p.key === active ? ' class="on"' : '') +
        (p.action ? ' data-action="' + p.action + '"' : '') + '>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round">' + p.icon + '</svg>' +
        p.label + badge + (p.soon ? ' <span class="soon">Soon</span>' : '') + '</a>';
    });
    html += '</nav>';
    html += '<div class="side-foot"><button class="logout" id="logoutBtn" type="button">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">' +
      '<path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>' +
      'Sign out</button></div>';
    return html;
  }

  /* ---------- display currency ----------
     "Default" shows each campaign in its own currency (a Rs campaign in
     rupees, a $ campaign in dollars). Picking a currency converts every
     figure on every page. Display only: see CXCUR in js/live.js. */
  (function curCss(){
    if(document.getElementById('cx-cur-css')) return;
    var st = document.createElement('style');
    st.id = 'cx-cur-css';
    st.textContent =
      '.cur-pick{position:relative;display:inline-flex;align-items:center;gap:6px;' +
        'height:32px;padding:0 10px 0 11px;border:1px solid var(--hair);border-radius:999px;' +
        'background:var(--surface,transparent);color:var(--ink-70);font:500 12px/1 var(--sans,Inter,sans-serif);' +
        'cursor:pointer;transition:border-color .25s ease}' +
      '.cur-pick:hover,.cur-pick:focus-within{border-color:var(--hair-warm,var(--hair))}' +
      '.cur-pick .cur-lab{letter-spacing:.14em;text-transform:uppercase;font-size:10px;color:var(--ink-40)}' +
      '.cur-pick select{appearance:none;-webkit-appearance:none;border:0;background:transparent;' +
        'color:var(--ink-90,inherit);font:inherit;padding:0 14px 0 0;cursor:pointer;outline:none}' +
      '.cur-pick select option{color:#111;background:#fff}' +
      '.cur-pick:after{content:"";position:absolute;right:11px;top:50%;width:5px;height:5px;margin-top:-4px;' +
        'border-right:1.5px solid var(--ink-40);border-bottom:1.5px solid var(--ink-40);transform:rotate(45deg);pointer-events:none}' +
      '@media (max-width:720px){.cur-pick .cur-lab{display:none}}';
    document.head.appendChild(st);
  })();

  function curPicker(){
    var X = window.CXCUR;
    if(!X) return '';
    var m = X.mode;
    var opts = '<option value="DEFAULT"' + (m === 'DEFAULT' ? ' selected' : '') + '>Default</option>' +
      X.LIST.map(function(cu){
        return '<option value="' + cu.c + '"' + (m === cu.c ? ' selected' : '') + '>' +
          cu.s + ' ' + cu.c + '</option>';
      }).join('');
    var tip = m === 'DEFAULT'
      ? 'Default: each campaign in its own currency. Totals across campaigns use their shared currency, or USD when they differ.'
      : 'Converted to ' + m + (X.asOf ? ' at the ' + X.asOf + ' reference rate' : '') +
        '. Display only: each campaign is billed in its own currency.';
    return '<label class="cur-pick" title="' + tip + '"><span class="cur-lab">Currency</span>' +
      '<select id="cxCurSel" aria-label="Display currency">' + opts + '</select></label>';
  }

  function wireCurPicker(){
    var sel = document.getElementById('cxCurSel');
    if(!sel || !window.CXCUR) return;
    sel.addEventListener('change', function(){
      if(!window.CXCUR.set(sel.value)) return;
      /* Every figure is derived at load from native amounts, so the
         cleanest repaint is a reload. The payload is cached for 90s,
         so this is a local redraw, not a refetch. */
      try{ sessionStorage.setItem('cx-cur-scroll', String(window.scrollY || 0)); }catch(e){}
      location.reload();
    });
    try{
      var y = sessionStorage.getItem('cx-cur-scroll');
      if(y != null){
        sessionStorage.removeItem('cx-cur-scroll');
        setTimeout(function(){ window.scrollTo(0, +y || 0); }, 60);
      }
    }catch(e){}
  }

  function topbar(label, active){
    var C = window.CLIPENCY;
    var isHome = HOME_KEYS.indexOf(active) > -1;
    var chip;
    if(isHome && window.CLIPDB){
      var pr = CLIPDB.profile();
      var initials = pr.name.split(/\s+/).map(function(w){ return w[0]; }).join('').slice(0,2).toUpperCase();
      chip = '<span class="client-chip">' +
        (pr.avatar ? '<img class="dot av" src="' + pr.avatar + '" alt="">' : '<span class="dot">' + initials + '</span>') +
        ' ' + pr.name + '</span>';
    } else {
      chip = '<span class="client-chip"><span class="dot">' + C.campaign.code + '</span> ' + C.campaign.client + '</span>';
    }
    return '<header class="topbar">' +
      '<span class="crumb"><b>' + (isHome ? 'Client Portal' : 'Campaign Dashboard') + '</b> &nbsp;/&nbsp; ' + label + '</span>' +
      '<span id="cxRouteSlot" style="margin-left:14px"></span>' +
      '<div class="top-right">' +
        curPicker() +
        '<button class="tour-btn" id="tourBtn" type="button" title="Take the tour" aria-label="Take the tour">?</button>' +
        '<button class="theme-switch" id="themeToggle" type="button" role="switch" aria-checked="false" aria-label="Switch theme">' +
          '<span class="ts-label" id="tsLabel">Dark Mode</span>' +
          '<span class="ts-track" aria-hidden="true"><span class="ts-knob">' +
            '<svg class="ts-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
              '<circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none"/>' +
              '<path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3L17 7M7 17l-1.7 1.7"/></svg>' +
            '<svg class="ts-moon" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>' +
          '</span></span>' +
        '</button>' +
        chip +
      '</div></header>';
  }

  /* ------------------------------------------------------------
     Nav prefetch
     ------------------------------------------------------------
     The pages are separate documents, so a click normally means: fetch
     HTML, then fetch the 6 scripts and the stylesheet it references, then
     parse, then render. Warming that up in advance is most of the
     difference between "page load" and "tab switch".

     Two stages, cheapest first:
       1. On idle, prefetch every sibling page at low priority. The shared
          assets (dashboard.css, data.js, shell.js, …) are then already in
          the HTTP cache whichever page you pick next.
       2. On hover/touch, upgrade that page to high priority, because a
          hover is a strong signal the click is coming.

     Uses <link rel="prefetch">, which is a hint — the browser is free to
     ignore it on a metered connection or low battery, which is correct
     behaviour and why this is safe to do for every link.
     ------------------------------------------------------------ */
  var prefetched = {};

  function prefetch(href, priority){
    if(!href || href === '#' || prefetched[href]) return;
    prefetched[href] = true;
    try{
      var l = document.createElement('link');
      l.rel = 'prefetch';
      l.href = href;
      l.as = 'document';
      if(priority) l.fetchPriority = priority;
      document.head.appendChild(l);
    }catch(e){ /* very old browser: navigation still works, just not warmed */ }
  }

  function prefetchNav(){
    // don't burn a metered connection on speculative fetches
    try{
      var c = navigator.connection;
      if(c && (c.saveData || /2g/.test(c.effectiveType || ''))) return;
    }catch(e){}

    var links = [].slice.call(
      document.querySelectorAll('.snav a[href]:not([href="#"]):not([href^="http"])')
    );

    links.forEach(function(a){
      // hover = near-certain click, so jump the queue
      var warm = function(){ prefetch(a.getAttribute('href'), 'high'); };
      a.addEventListener('mouseenter', warm, { once:true, passive:true });
      a.addEventListener('touchstart', warm, { once:true, passive:true });
      a.addEventListener('focus',      warm, { once:true });
    });

    var idle = window.requestIdleCallback || function(fn){ return setTimeout(fn, 800); };
    idle(function(){
      links.forEach(function(a){ prefetch(a.getAttribute('href')); });
    });
  }

  function init(active){
    var list = pagesFor(active);
    var page = list.filter(function(p){ return p.key === active; })[0] || list[0];
    document.getElementById('side').outerHTML =
      '<aside class="side">' + sidebar(active) + '</aside>';
    document.getElementById('topbar').outerHTML = topbar(page.label, active);
    wireCurPicker();

    /* Same account, other surfaces. The switcher asks the database what this
       login can open and renders nothing if the answer is only this one, so a
       plain client never sees a door they cannot walk through.

       Two things are not ready yet when the shell paints: the module itself
       (loaded here rather than adding a tag to every portal page) and the
       Supabase client, which js/live.js creates after this file runs. So this
       waits for both, briefly, instead of silently doing nothing. */
    (function mountRouteSwitch(tries){
      var slot = document.getElementById('cxRouteSlot');
      if(!slot) return;
      if(!window.CXRouteSwitch){
        if(!document.getElementById('cx-rs-js')){
          var js = document.createElement('script');
          js.id = 'cx-rs-js';
          js.src = '/clipency-route-switch.js';
          document.head.appendChild(js);
        }
      }
      var sb = window.supabaseClient || window.sbClient;
      if(window.CXRouteSwitch && sb){
        CXRouteSwitch.mount({sb: sb, current: 'client', into: slot});
        return;
      }
      if(tries > 0) setTimeout(function(){ mountRouteSwitch(tries - 1); }, 150);
    })(40);

    /* theme */
    var html = document.documentElement;
    var btn = document.getElementById('themeToggle');
    var lbl = document.getElementById('tsLabel');
    function sync(){
      var dark = html.getAttribute('data-theme') === 'dark';
      btn.setAttribute('aria-checked', dark);
      lbl.textContent = dark ? 'Light Mode' : 'Dark Mode';
    }
    btn.addEventListener('click', function(){
      var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      html.classList.add('theming');
      html.setAttribute('data-theme', next);
      try{ localStorage.setItem('clipency-theme', next); }catch(e){}
      sync();
      clearTimeout(window.__thmT);
      window.__thmT = setTimeout(function(){ html.classList.remove('theming'); }, 620);
    });
    sync();

    /* Sign out.

       This used to remove the 'clipency-access' PIN flag and navigate to
       the PIN page. Under real auth that signs nobody out: the Supabase
       session stays in localStorage, so pressing Back — or simply
       revisiting — put the client straight back into the dashboard with
       another client's cached rows still in sessionStorage. */
    document.getElementById('logoutBtn').addEventListener('click', async function(){
      try{ localStorage.removeItem('cx-last-portal'); }catch(e){}
      try{ sessionStorage.removeItem('clipency-access'); }catch(e){}
      try{ sessionStorage.removeItem('clipency-live-v2'); }catch(e){}
      try{ localStorage.removeItem('clipency-store-v2'); }catch(e){}
      try{
        var sb = window.clipencySupabase;
        if(sb && sb.auth && sb.auth.signOut) await sb.auth.signOut();
      }catch(e){ /* sign out locally regardless */ }
      var url = (window.CLIPENCY_CONFIG && window.CLIPENCY_CONFIG.SIGNIN_URL) || './client-signin.html';
      location.href = url;
    });

    /* soon links */
    document.querySelectorAll('.snav a[href="#"]').forEach(function(a){
      a.addEventListener('click', function(e){ e.preventDefault(); });
    });

    prefetchNav();

    /* contact admin popup */
    var con = document.querySelector('.snav a[data-action="contact"]');
    if(con) con.addEventListener('click', function(e){ e.preventDefault(); openContact(); });

    /* tour */
    var tb = document.getElementById('tourBtn');
    if(tb) tb.addEventListener('click', function(){
      if(window.CLIPTOUR) CLIPTOUR.start();
    });

    /* export */
    var exp = document.querySelector('.snav a[data-action="export"]');
    if(exp) exp.addEventListener('click', function(e){
      e.preventDefault();
      if(exp.classList.contains('busy')) return;
      exp.classList.add('busy');
      toast('Preparing your report…');
      window.CLIPEXPORT.download().then(function(){
        toast('Report downloaded — Clipency_' + (window.CLIPENCY ? CLIPENCY.campaign.code : '') + '_Campaign_Report.xlsx');
      }).catch(function(){
        toast('Export failed — check your connection and try again.', true);
      }).then(function(){ exp.classList.remove('busy'); });
    });
  }

  /* ---------- contact admin popup ---------- */
  function openContact(){
    var v = document.getElementById('contactVeil');
    if(!v){
      var A = (window.CLIPDB && CLIPDB.ADMIN) || {};
      v = document.createElement('div');
      v.className = 'modal-veil'; v.id = 'contactVeil';
      v.innerHTML =
        '<div class="modal" style="max-width:480px;" role="dialog" aria-label="Contact admin">' +
          '<button class="m-x" type="button">×</button>' +
          '<h3>Contact your Clipency manager</h3>' +
          '<p class="m-sub">We usually reply within a few hours. Pick whichever channel you prefer.</p>' +
          '<div class="con-list">' +
            '<a class="con-row" href="mailto:' + A.email + '">' +
              '<span class="con-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 7 8.5 6 8.5-6"/></svg></span>' +
              '<span class="con-main"><b>Email</b><span>' + A.email + '</span></span>' +
              '<span class="con-arr">&#8599;</span></a>' +
            /* WhatsApp row removed: contact is email or Discord only. */
            '<a class="con-row" href="' + A.discord + '" target="_blank" rel="noopener">' +
              '<span class="con-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M8.5 17.5c-2.1-.6-3.5-1.8-3.5-1.8.3-4 1.4-7.1 2.4-8.6 0 0 1.7-.9 3.6-1.1l.4.9a12 12 0 0 1 1.2-.1c.4 0 .8 0 1.2.1l.4-.9c1.9.2 3.6 1.1 3.6 1.1 1 1.5 2.1 4.6 2.4 8.6 0 0-1.4 1.2-3.5 1.8l-.9-1.4c.6-.2 1.6-.7 1.6-.7-2.3 1.4-7.3 1.4-9.6 0 0 0 1 .5 1.6.7z"/><circle cx="9.6" cy="12.3" r="1" fill="currentColor" stroke="none"/><circle cx="14.4" cy="12.3" r="1" fill="currentColor" stroke="none"/></svg></span>' +
              '<span class="con-main"><b>Discord</b><span>Open a ticket on our server</span></span>' +
              '<span class="con-arr">&#8599;</span></a>' +
          '</div>' +
        '</div>';
      document.body.appendChild(v);
      v.querySelector('.m-x').addEventListener('click', function(){ v.classList.remove('show'); });
      v.addEventListener('click', function(e){ if(e.target === v) v.classList.remove('show'); });
    }
    requestAnimationFrame(function(){ v.classList.add('show'); });
  }

  /* ---------- toast ---------- */
  function toast(msg, bad){
    var t = document.getElementById('clipToast');
    if(!t){
      t = document.createElement('div');
      t.id = 'clipToast'; t.className = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.toggle('bad', !!bad);
    t.classList.add('show');
    clearTimeout(window.__toastT);
    window.__toastT = setTimeout(function(){ t.classList.remove('show'); }, 3400);
  }

  /* ---------- empty state for campaigns without clips yet ----------
     Pages call: if(CLIPSHELL.emptyState()) return;  right after init. */
  function emptyState(){
    if(!window.CLIPDB || !window.CLIPENCY) return false;
    if(CLIPENCY.submissions.length) return false;
    /* First clips still waiting for the client's approval: open the portal,
       the Clips Feed has something for them to do. */
    if(CLIPENCY.pending && CLIPENCY.pending.length) return false;
    var c = CLIPDB.active();
    var status = c ? c.status : 'review';
    var head = status === 'review' ? 'Campaign in review'
             : status === 'ended'  ? 'Campaign ended'
             : 'Warming up the network';
    var sub = status === 'review'
      ? 'Our team is reviewing “' + CLIPENCY.campaign.client + '”. Once approved it goes live to the clipper network and the first clips usually land within 48 hours.'
      : status === 'ended'
      ? 'This campaign has ended. Its data stays available here, and any unspent budget was returned to your wallet.'
      : 'Your campaign is live. Clips will appear here as the network starts posting.';
    document.querySelector('.content').innerHTML =
      '<div class="empty-hero">' +
        '<div class="empty-mark">' + (status === 'review' ? '◷' : status === 'ended' ? '◼' : '◉') + '</div>' +
        '<span class="eyebrow">' + CLIPENCY.campaign.client + '</span>' +
        '<h1>' + head + '</h1>' +
        '<p>' + sub + '</p>' +
        '<div class="empty-meta">' +
          '<span>Budget reserved <b>' + CLIPENCY.money(CLIPENCY.campaign.budget) + '</b></span>' +
          /* A per-video campaign has no rate per 1,000 views (rpm is zeroed on
             save), so it shows its price per approved video: on one half of a
             split campaign, that platform's price. */
          (CLIPENCY.campaign.payoutModel === 'per_video'
            ? '<span>RPV <b>' + CLIPENCY.money(CLIPENCY.campaign.ratePerVideo) + ' / video</b></span>'
            : '<span>Rate <b>' + CLIPENCY.money(CLIPENCY.campaign.cpm) + ' / 1,000 views</b></span>') +
          (c && c.category ? '<span>Category <b>' + c.category + '</b></span>' : '') +
        '</div>' +
        briefPanel(c) +
        '<a class="btn" href="./home.html">Back to Home <span class="arr">&#8594;</span></a>' +
      '</div>';
    return true;
  }

  /* Campaign brief block (requirements / guidelines / content link) */
  function briefPanel(c){
    if(!c) return '';
    var has = (c.requirements && c.requirements.length) || c.guidelines || c.contentLink || c.description;
    if(!has) return '';
    var html = '<div class="brief-box">';
    if(c.description) html += '<div class="brief-sec"><span class="brief-l">Brief</span><p>' + c.description + '</p></div>';
    if(c.requirements && c.requirements.length)
      html += '<div class="brief-sec"><span class="brief-l">Requirements</span><ul>' +
        c.requirements.map(function(r){ return '<li>' + r + '</li>'; }).join('') + '</ul></div>';
    if(c.guidelines) html += '<div class="brief-sec"><span class="brief-l">Content guidelines</span><p>' + c.guidelines + '</p></div>';
    if(c.contentLink) html += '<div class="brief-sec"><a class="btn btn-line" href="' + c.contentLink + '" target="_blank" rel="noopener">Content access link <span class="arr">&#8599;</span></a></div>';
    return html + '</div>';
  }

  /* ---------- tiny SVG chart helpers (theme-aware) ---------- */
  function css(v){ return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

  /* animated counter

     The count-up is a nice first impression but actively harmful on every
     subsequent navigation: 1.6s of numbers spinning is the opposite of a tab
     switch, and it reads as the page still loading. So animate once per tab,
     then paint instantly. */
  var COUNTED_KEY = 'clipency-counted';

  function alreadyCounted(){
    try{ return sessionStorage.getItem(COUNTED_KEY) === '1'; }
    catch(e){ return false; }
  }
  function markCounted(){
    try{ sessionStorage.setItem(COUNTED_KEY, '1'); }catch(e){}
  }

  function count(el, target, fmt, dur){
    var reduce = false;
    try{
      reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }catch(e){}

    if(reduce || alreadyCounted()){
      el.textContent = fmt(target);
      return;
    }

    dur = dur || 1100;               // was 1600 — still lands, feels quicker
    markCounted();
    var t0 = performance.now();
    (function tick(now){
      var p = Math.min((now - t0)/dur, 1);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(target * e);
      if(p < 1) requestAnimationFrame(tick);
      else el.textContent = fmt(target);   // land exactly, no rounding drift
    })(t0);
  }

  return { init:init, css:css, count:count, PAGES:PAGES, toast:toast, emptyState:emptyState, openContact:openContact, briefPanel:briefPanel };
})();
