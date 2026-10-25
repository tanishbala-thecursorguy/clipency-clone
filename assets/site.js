/* Clipency site script, shared by every page. Each block checks for its own
   elements first, so a page only runs what it actually has. */
(function(){
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /* ---- app links: the clipper / creator / client portals ---- */
  const APP = '';   /* the dashboards and logins live on the same site as these pages */
  /* ?from= tells the sign-in page's "Back to site" which page to return to */
  $$('[data-app]').forEach(a => a.setAttribute('href', APP + a.getAttribute('data-app') + '?from=' + encodeURIComponent(location.href.split('#')[0])));

  /* ---- nav: glass on scroll, current page, mobile menu ---- */
  const nav = $('#nav');
  if(nav){
    const onScroll = () => nav.classList.toggle('scrolled', scrollY > 24);
    onScroll(); addEventListener('scroll', onScroll, {passive:true});
    const here = location.pathname.replace(/index\.html$/, '').replace(/\/+$/, '') || '/';
    $$('.nav-links a, .menu-panel a[data-page]').forEach(a => {
      const p = (a.getAttribute('href') || '').replace(/\/+$/, '') || '/';
      if(p === here){ a.classList.add('is-here'); a.setAttribute('aria-current', 'page'); }
    });
    const mb = $('#menuBtn'), panel = $('#menuPanel');
    if(mb && panel){
      const set = open => { nav.classList.toggle('menu-open', open); mb.setAttribute('aria-expanded', open ? 'true' : 'false'); };
      mb.addEventListener('click', () => set(!nav.classList.contains('menu-open')));
      $$('a', panel).forEach(a => a.addEventListener('click', () => set(false)));
      addEventListener('keydown', e => { if(e.key === 'Escape') set(false); });
    }
  }

  /* ---- side page guide: built from [data-guide] sections, follows the scroll ---- */
  const guideHost = $('#pageGuide'), guided = $$('[data-guide]');
  if(guideHost && guided.length > 1){
    guideHost.innerHTML = '<ol>' + guided.map(s =>
      '<li><a href="#' + s.id + '" data-to="' + s.id + '"><span class="g-label">' + s.dataset.guide + '</span><span class="g-dot"></span></a></li>'
    ).join('') + '</ol>';
    const links = $$('a', guideHost);
    const mark = id => links.forEach(a => a.classList.toggle('on', a.dataset.to === id));
    const gio = new IntersectionObserver(es => {
      es.forEach(e => { if(e.isIntersecting) mark(e.target.id); });
    }, {rootMargin:'-45% 0px -50% 0px'});
    guided.forEach(s => gio.observe(s));
    mark(guided[0].id);
    /* the guide fades out over the footer */
    const foot = $('.footer');
    if(foot) new IntersectionObserver(es => es.forEach(e => guideHost.classList.toggle('away', e.isIntersecting)), {threshold:.15}).observe(foot);
  }

  /* ---- below-the-fold paintings load only when you are about to reach them ---- */
  const lazyImgs = $$('img[data-src]');
  if('IntersectionObserver' in window){
    /* watch each painting's section, not the image: an image with no size yet never counts as visible */
    const lio = new IntersectionObserver(es => es.forEach(e => {
      if(!e.isIntersecting) return;
      $$('img[data-src]', e.target).forEach(i => { if(!i.getAttribute('src')) i.src = i.dataset.src; });
      lio.unobserve(e.target);
    }), {rootMargin: '600px 0px'});
    new Set(lazyImgs.map(i => i.closest('section, footer') || i.parentElement)).forEach(sec => lio.observe(sec));
  } else lazyImgs.forEach(i => { i.src = i.dataset.src; });

  /* ---- scroll reveals ---- */
  const reveals = $$('.reveal');
  if(reduced || !('IntersectionObserver' in window)) reveals.forEach(el => el.classList.add('visible'));
  else{
    const io = new IntersectionObserver(es => es.forEach(e => { if(e.isIntersecting){ e.target.classList.add('visible'); io.unobserve(e.target); } }),
      {threshold:.14, rootMargin:'0px 0px -6% 0px'});
    reveals.forEach(el => io.observe(el));
  }

  /* ---- counters: the real number is in the HTML; this only animates up to it ---- */
  const fmt = (v, dec) => dec > 0 ? v.toFixed(dec) : Math.round(v).toLocaleString('en-US');
  if(!reduced){
    const cio = new IntersectionObserver(es => es.forEach(e => {
      if(!e.isIntersecting) return; cio.unobserve(e.target);
      const el = e.target, to = parseFloat(el.dataset.count), dec = parseInt(el.dataset.decimals || '0', 10);
      const pre = el.dataset.prefix || '', suf = el.dataset.suffix || '', t0 = performance.now(), dur = 2000;
      (function tick(now){
        const p = Math.min((now - t0) / dur, 1), k = 1 - Math.pow(1 - p, 3);
        el.textContent = pre + fmt(to * k, dec) + suf;
        if(p < 1) requestAnimationFrame(tick);
      })(t0);
    }), {threshold:.5});
    $$('[data-count]').forEach(el => cio.observe(el));
  }

  /* ---- the rule of seven meter: seven sightings, one buyer ---- */
  const meter = $('#meter');
  if(meter){
    const views = $$('.view', meter), bar = $('#feelBar'), txt = $('#feelTxt'), cap = $('#feelCap');
    const FEEL = ['Never heard of it','Scrolled past','"Seen that before"','Getting curious','Checks the profile','Asks a friend','Trusts it','Wants it, badly'];
    let timer = null;
    const setSeen = n => {
      views.forEach((v, i) => v.classList.toggle('on', i < n));
      bar.style.width = (n / 7 * 100) + '%'; txt.textContent = FEEL[n];
      cap.textContent = n ? 'Seen ' + n + ' time' + (n > 1 ? 's' : '') + (n === 7 ? ', now they come looking for you' : '') : 'Seen 0 times';
    };
    /* it loops: counts up to seven, holds on "Wants it, badly", then starts over, but only while on screen */
    let onScreen = false, again = null;
    const play = () => {
      clearInterval(timer); clearTimeout(again); setSeen(0);
      if(reduced){ setSeen(7); return; }
      let n = 0; timer = setInterval(() => {
        n++; setSeen(n);
        if(n >= 7){ clearInterval(timer); again = setTimeout(() => { if(onScreen) play(); }, 3200); }
      }, 700);
    };
    setSeen(0);
    new IntersectionObserver(es => es.forEach(e => {
      const was = onScreen; onScreen = e.isIntersecting;
      if(onScreen && !was) play();
      if(!onScreen){ clearInterval(timer); clearTimeout(again); }
    }), {threshold:.5}).observe(meter);
  }

  /* ---- secret method: the seven touches light up as you scroll past them ---- */
  const touches = $$('.touch');
  if(touches.length){
    const tio = new IntersectionObserver(es => es.forEach(e => e.target.classList.toggle('lit', e.isIntersecting || e.boundingClientRect.top < 0)),
      {rootMargin:'0px 0px -42% 0px'});
    touches.forEach(t => tio.observe(t));
  }

  /* ---- why us: the hype curve draws itself ---- */
  $$('.curve').forEach(c => {
    const cio2 = new IntersectionObserver(es => es.forEach(e => { if(e.isIntersecting){ c.classList.add('drawn'); cio2.disconnect(); } }), {threshold:.35});
    cio2.observe(c);
  });

  /* ---- services picker; the form chips stay in sync ---- */
  const SVC = {films:{name:'Launch Films', vol:'1–6 films'}, dist:{name:'Mass Distribution', vol:'1K–10K posts'}, ugc:{name:'UGC Creators', vol:'1K–5K / month'}};
  const picked = new Set();
  const planName = $('#planName');
  function paintPlan(){
    $$('[data-svc]').forEach(b => { const on = picked.has(b.dataset.svc); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    if(!planName) return;
    const n = picked.size;
    planName.textContent = n === 3 ? 'The Full Launch Engine' : n === 0 ? 'Pick a service' : n === 1 ? SVC[[...picked][0]].name + ' only' : 'A custom launch';
    $('#planItems').innerHTML = [...picked].map(k => '<li>' + SVC[k].name + '<span>' + SVC[k].vol + '</span></li>').join('');
    $('#planNote').textContent = n === 3
      ? 'Films build the story, distribution makes it unmissable and UGC makes it believable. This is how the rule of seven is won.'
      : n ? 'Good start. You can add the rest any time, or keep it to just this.' : 'Tap any service on the left to add it.';
    $('#planGo').setAttribute('aria-disabled', n ? 'false' : 'true');
    $('#planAll').hidden = n === 3;
  }
  $$('[data-svc]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.svc; picked.has(k) ? picked.delete(k) : picked.add(k); paintPlan();
    const err = $('#fErr'); if(err) err.hidden = true;
  }));
  const all = $('#planAll'); if(all) all.onclick = () => { Object.keys(SVC).forEach(k => picked.add(k)); paintPlan(); };
  $$('[data-pick]').forEach(a => a.addEventListener('click', () => {
    const st = $('#fStage'); if(st) st.value = a.dataset.pick === 'startup' ? 'startup' : 'company';
    if(!picked.size){ Object.keys(SVC).forEach(k => picked.add(k)); paintPlan(); }
  }));
  paintPlan();

  /* ---- book a call: details -> Calendly (synced to Tanish's Google Calendar) -> booked.
     The booking is saved as a lead (submit_landing_lead); lead-welcome then emails the
     booked time (and WhatsApps it once the WhatsApp Business Platform is connected). ---- */
  const form = $('#startForm');
  if(form){
    const SB = 'https://spwtkdgpgeutrhwcjrpy.supabase.co', KEY = 'sb_publishable_IInNrDBLK3dINHSyWaUDzg_UWF63j0B';
    const CAL = 'https://calendly.com/tanish-clipency/30min';
    const val = id => (($('#' + id) || {}).value || '').trim();
    const cal = $('#bkCal'), ok = $('#fOk'), err = $('#fErr');
    let who = null, saved = false;
    const step = n => $$('.bk-steps [data-s]').forEach(e => e.classList.toggle('on', +e.dataset.s <= n));
    const loadCalendly = () => new Promise((res, rej) => {
      if(window.Calendly) return res();
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://assets.calendly.com/assets/external/widget.css'; document.head.appendChild(css);
      const sc = document.createElement('script'); sc.src = 'https://assets.calendly.com/assets/external/widget.js'; sc.async = true;
      sc.onload = () => res(); sc.onerror = () => rej(new Error('calendar')); document.head.appendChild(sc);
    });
    async function save(booking){
      if(saved) return; saved = true;
      const payload = { full_name: who.name, email: who.email, phone: who.phone, website: who.website, budget: who.budget, source_page: location.pathname || '/',
                        whatsapp_ok: true, form: 'book-call', booking };
      try{
        await fetch(SB + '/rest/v1/rpc/submit_landing_lead', { method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: 'Bearer ' + KEY },
          body: JSON.stringify({ payload }), keepalive: true });
      }catch(e){ /* Calendly already has the booking and emails its own invite */ }
    }
    form.addEventListener('submit', async e => {
      e.preventDefault();
      err.hidden = true;
      if(!form.checkValidity()){ form.reportValidity(); return; }
      const digits = val('fPhone').replace(/\D/g, '').replace(/^0+/, '');
      if(digits.length < 6 || digits.length > 13){ err.textContent = 'Enter your WhatsApp number without the country code (pick that on the left).'; err.hidden = false; return; }
      if(!/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(val('fSite'))){ err.textContent = 'Enter your website, like company.com.'; err.hidden = false; return; }
      who = { name: val('fName'), email: val('fEmail'), phone: '+' + val('fCc') + ' ' + digits, website: val('fSite'), budget: val('fBudget') };
      form.hidden = true; cal.hidden = false; step(2);
      cal.scrollIntoView({ behavior: 'smooth', block: 'start' });
      try{ await loadCalendly(); }
      catch(ex){ $('#bkWidget').innerHTML = '<div class="bk-loading">The calendar didn’t load. <a href="' + CAL + '" target="_blank" rel="noopener">Open it here</a>.</div>'; return; }
      const box = $('#bkWidget'); box.innerHTML = '';
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      window.Calendly.initInlineWidget({
        url: CAL + '?hide_gdpr_banner=1&hide_landing_page_details=1' + (dark ? '&background_color=1c1916&text_color=efebe3&primary_color=d8aa74' : '&primary_color=8c6a45'),
        parentElement: box,
        prefill: { name: who.name, email: who.email, customAnswers: { a1: who.phone } }
      });
    });
    $('#bkBack').addEventListener('click', () => { cal.hidden = true; form.hidden = false; step(1); $('#fName').focus(); });
    window.addEventListener('message', e => {
      if(!e.data || typeof e.data.event !== 'string' || e.origin.indexOf('calendly.com') === -1) return;
      if(e.data.event === 'calendly.event_scheduled'){
        const p = e.data.payload || {};
        save({ event_uri: p.event && p.event.uri, invitee_uri: p.invitee && p.invitee.uri, booked_at: new Date().toISOString() });
        setTimeout(() => { cal.hidden = true; $('.bk-steps').hidden = true; ok.classList.add('show'); ok.focus({ preventScroll: true }); }, 2600);
      }
    });
  }

  /* ---- theme ---- */
  const tBtn = $('#themeToggle');
  if(tBtn){
    const root = document.documentElement, lb = $('.ts-label', tBtn);
    const label = () => { const d = root.getAttribute('data-theme') === 'dark';
      if(lb) lb.textContent = d ? 'Light Mode' : 'Dark Mode';
      tBtn.setAttribute('aria-checked', d ? 'true' : 'false'); tBtn.setAttribute('aria-label', d ? 'Switch to light mode' : 'Switch to dark mode'); };
    label();
    tBtn.addEventListener('click', () => {
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.classList.add('theme-snap'); root.setAttribute('data-theme', next);
      try{ localStorage.setItem('clipency-theme', next); }catch(e){}
      label(); requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-snap')));
    });
  }

  /* ---- falling cherry blossom + the branch in the wind ----
     The blossoms are cut straight from the branch painting (/art/bloom1-7.webp).
     About every fifteen seconds a soft gust leans on the branch; it eases in and out
     at the same pace as the branch settling when the page opens, and shakes a few
     blossoms loose. Between gusts it only breathes. */
  /* performance: lite devices run at ~30fps; nothing animates while the hero is off screen */
  const LITE = document.documentElement.classList.contains('lite');
  const FRAME_MS = LITE ? 33 : 0;
  /* low-end phones/PCs, slow connections and "reduce motion": a still painting, no animation loops at all */
  const STILL = reduced || LITE;
  /* loops park themselves while the hero is off screen and are woken when it comes back */
  const parked = [];
  let heroOn = true;
  const heroEl = $('.hero');
  if(heroEl && 'IntersectionObserver' in window){
    new IntersectionObserver(es => es.forEach(e => {
      heroOn = e.isIntersecting;
      if(heroOn) parked.splice(0).forEach(fn => requestAnimationFrame(fn));
      $$('.scene svg').forEach(svg => { try{ heroOn ? svg.unpauseAnimations() : svg.pauseAnimations(); }catch(_){} });
    }), {threshold: 0}).observe(heroEl);
  }
  /* lite: the water holds still (the SVG ripple is the most expensive effect on the page) */
  if(LITE){ $$('.scene animate').forEach(a => a.remove()); const w = $('.sc-water'); if(w) w.removeAttribute('filter'); }

  const field = $('#leafField'), artLeft = $('.hero-art-left'), artMist = $('.hero-art-right');
  if(!STILL && field && artLeft){
    const BLOOMS = [1,2,3,4,5,6,7].map(n => '/art/bloom' + n + '.webp');
    /* where the blossoms sit on the branch painting, as fractions of its width / height */
    const ANCHORS = [[.04,.06],[.13,.04],[.18,.12],[.08,.32],[.16,.28],[.24,.30],[.30,.42],[.33,.40],[.43,.33],[.50,.41],
                     [.56,.36],[.40,.47],[.44,.58],[.49,.54],[.56,.72],[.64,.59],[.74,.65],[.67,.72],[.74,.78],[.28,.65],
                     [.09,.54],[.04,.44],[.38,.77],[.22,.57]];
    const leaves = [], drops = [];
    let last = performance.now(), T = 0, sy = scrollY, docH = 0, target = 0;
    let base = 0, gust = 0, gustAim = 0, gustEnd = 0, nextGust = 2.5, bend = 0, nextLoose = 5;
    function measure(){
      /* blossoms only fall from the branch, so the layer only needs to cover the hero and a
         screen below it; sizing it to the whole page used to push blank space under the footer */
      const hero = $('.hero');
      docH = Math.round((hero ? hero.offsetHeight : innerHeight) + innerHeight); field.style.height = docH + 'px';
      target = Math.max(10, Math.min(26, Math.round(docH / 520 * Math.min(innerWidth, 1400) / 1200)));
    }
    const wind = t => 4 + 12*Math.sin(t*.11) + 7*Math.sin(t*.24 + 1.7) + 5*Math.sin(t*.5 + .6);
    /* seedY: born mid-fall anywhere on the page (first paint). bx/by: shaken off the branch. Neither: drifts in from the top. */
    function makeLeaf(seedY, bx, by){
      const branch = bx !== undefined, img = document.createElement('img');
      img.className = 'leaf'; img.alt = ''; img.src = BLOOMS[(Math.random()*BLOOMS.length)|0];
      /* branch blossoms leave at the size they were painted; the drifting ones vary */
      const size = branch ? 20 + Math.random()*12 : 11 + Math.random()*13, z = size / 24;
      img.style.width = size.toFixed(1) + 'px';
      let x, y, age;
      if(branch){ x = bx; y = by; age = 0; }
      else if(seedY !== undefined){ x = innerWidth * (.02 + Math.random()*.96); y = seedY; age = 3 + Math.random()*8; }
      else { x = innerWidth * (.02 + Math.random()*.96); y = -30 - Math.random()*120; age = 0; }
      const L = {el:img, z:.6 + z*.5, age, x, y, branch, shown:true,
        /* about a third get caught by the wind and sail off downwind; the rest mostly fall,
           drifting the same way, only gently */
        carry: branch && Math.random() < .35,
        vx:0, vyT:0,
        tau:branch ? 1.2 + Math.random()*.8 : 1.1 + Math.random(),   /* a shaken blossom hangs a beat, then falls */
        A:.6 + Math.random()*.6, w:1.1 + Math.random()*1.0, phi:Math.random()*6.283,
        ax:20 + Math.random()*24, ay:18 + Math.random()*22,
        w1:.6 + Math.random()*.7, w2:.5 + Math.random()*.6, p1:Math.random()*6.283, p2:Math.random()*6.283,
        drift:(Math.random()*2 - 1)*30, flip:Math.random() < .5};
      L.vx = L.carry ? 90 + Math.random()*70 : 6 + Math.random()*26;
      L.vyT = L.carry ? 14 + Math.random()*10 : 26 + Math.random()*16;
      img.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
      field.appendChild(img); leaves.push(L);
    }
    function fromBranch(){
      const ar = artLeft.getBoundingClientRect(), a = ANCHORS[(Math.random()*ANCHORS.length)|0];
      makeLeaf(undefined, ar.left + a[0]*ar.width + (Math.random()*8 - 4) - 12, scrollY + ar.top + a[1]*ar.height + (Math.random()*6 - 3) - 12);
    }
    let branchInView = true;
    if('IntersectionObserver' in window) new IntersectionObserver(es => es.forEach(e => { branchInView = e.isIntersecting; })).observe(artLeft);
    measure();
    addEventListener('resize', measure); addEventListener('load', measure); setTimeout(measure, 1200);
    let lastDraw = 0;
    (function frame(now){
      if(!heroOn && !leaves.length){ last = now; parked.push(t => { last = t; frame(t); }); return; }   /* stops while scrolled away */
      if(now - lastDraw < FRAME_MS){ requestAnimationFrame(frame); return; } lastDraw = now;
      const dt = Math.min((now - last)/1000, .05); last = now; T += dt;
      const vw = innerWidth, vh = innerHeight, sc = scrollY, top = sc - vh*.4, bot = sc + vh*1.4;

      /* a gust every ~15 s: it leans on the branch for about a second, then lets it come back */
      if(T >= nextGust){
        gustAim = 1.5 + Math.random()*1.0; gustEnd = T + .8 + Math.random()*.4; nextGust = T + 19 + Math.random()*2;   /* a gust about every 20 s */
        if(branchInView){ const n = 1 + ((Math.random()*2)|0); for(let k = 0; k < n; k++) drops.push(T + .2 + Math.random()*.7); }   /* one or two let go */
        /* the gust also catches every blossom already in the air and nudges it right */
        leaves.forEach(L => { L.vx += 45 + Math.random()*45; });
      }
      if(T > gustEnd) gustAim = 0;
      const ease = Math.min(1, dt * 1.4);                 /* the same pace as the branch settling on page load */
      gust += (gustAim - gust) * ease;
      base += ((Math.sin(T*.55)*.35 + Math.sin(T*.23 + 1.3)*.25) - base) * ease;
      bend += ((gust*.22 + Math.sin(T*.37 + .7)*.15) - bend) * Math.min(1, dt * 1.1);
      const sway = base + gust;
      window.__cxGust = gust;
      /* between gusts the odd blossom still works itself loose, but only ever from the branch */
      if(T >= nextLoose){ nextLoose = T + 9 + Math.random()*5; if(branchInView) drops.push(T); }
      for(let k = drops.length - 1; k >= 0; k--){ if(T >= drops[k]){ drops.splice(k, 1); if(leaves.length < (LITE ? 2 : 3)) fromBranch(); }   /* never more than three in the air (two on lite) */ }

      /* the falling blossoms feel the same gust: they get pushed along while it blows */
      const W = wind(T) + gust * 9;
      for(let i = leaves.length - 1; i >= 0; i--){
        const L = leaves[i]; L.age += dt;
        const settle = 1 - Math.exp(-L.age / L.tau), p = L.w * L.age + L.phi, rock = Math.sin(p), lean = Math.cos(p);
        /* the breeze carries everything to the right; a freshly shaken blossom keeps its throw
           for a while, so it sails across the page instead of dropping straight down */
        L.vx *= Math.exp(-dt / (L.carry ? 9 : 3));
        L.x += ((W + 6) * L.z * (L.carry ? 1.4 : .5) + gust * 22 + L.vx + lean * L.A * 40 * settle) * dt;
        L.y += L.vyT * L.z * settle * (1 - .3 * Math.abs(rock)) * dt;
        if(L.y > docH - 30 || L.x > vw + 80 || L.x < -90){ L.el.remove(); leaves.splice(i, 1); continue; }
        if(L.y > top && L.y < bot){
          if(!L.shown){ L.el.style.visibility = 'visible'; L.shown = true; }
          let o = Math.min(L.age / (L.branch ? .2 : 1.2), 1); if(L.y > docH - 140) o = Math.min(o, Math.max((docH - 30 - L.y) / 110, 0));
          L.el.style.opacity = (o * .95).toFixed(3);
          L.el.style.transform = 'translate3d(' + L.x.toFixed(1) + 'px,' + L.y.toFixed(1) + 'px,0) perspective(400px) rotate(' + (L.A*rock*46 + L.drift*L.age).toFixed(1) + 'deg)' +
            ' rotateX(' + (L.ax*Math.sin(L.w1*L.age + L.p1)).toFixed(1) + 'deg) rotateY(' + (L.ay*Math.sin(L.w2*L.age + L.p2)).toFixed(1) + 'deg)' + (L.flip ? ' scaleX(-1)' : '');
        } else if(L.shown){ L.el.style.visibility = 'hidden'; L.shown = false; }
      }

      sy += (sc - sy) * .085; const dy = Math.min(sy, 1200);
      /* the branch pivots where it enters the frame, so the tips travel and the base barely moves */
      artLeft.style.transform = 'translate3d(0,' + (dy*.045 + sway*4).toFixed(2) + 'px,0) rotate(' + sway.toFixed(3) + 'deg) skewX(' + bend.toFixed(3) + 'deg)';
      if(artMist) artMist.style.transform = 'translate3d(0,' + (dy*.09).toFixed(1) + 'px,0)';
      requestAnimationFrame(frame);
    })(last);
  }

  /* ---- the lake: a traveller walks down the stone steps, through the torii and along the
          dock, boards the boat, and the boat sails away up the river into the mist. Then the
          boat drifts back to the dock and the next traveller comes down. Pines and lanterns
          move with the same wind as the cherry branch; ripples spread from the boat. ---- */
  const scBoat = $('#scBoat'), scMan = $('#scMan');
  if(scBoat && scMan){
    const NS = 'http://www.w3.org/2000/svg';
    const legA = $('#mLegA'), legB = $('#mLegB'), trees = $$('.sc-tree'), lanterns = $$('.sc-lantern');
    const ringG = $('#scRings');
    const qb = (t, a, b, c) => [(1-t)*(1-t)*a[0] + 2*(1-t)*t*b[0] + t*t*c[0], (1-t)*(1-t)*a[1] + 2*(1-t)*t*b[1] + t*t*c[1]];
    const cb = (t, a, b, c, d) => { const u = 1 - t; return [u*u*u*a[0] + 3*u*u*t*b[0] + 3*u*t*t*c[0] + t*t*t*d[0], u*u*u*a[1] + 3*u*u*t*b[1] + 3*u*t*t*c[1] + t*t*t*d[1]]; };

    /* the route: along the foot of the left cliff, under the torii, out onto the little dock */
    const route = [[328,818], [362,820], [396,821], [420,822], [434,822.6], [487,830.4]];
    const cum = [0];
    for(let i = 1; i < route.length; i++) cum.push(cum[i-1] + Math.hypot(route[i][0]-route[i-1][0], route[i][1]-route[i-1][1]));
    const total = cum[cum.length - 1];
    const at = d => {
      d = Math.max(0, Math.min(total, d));
      let i = 1; while(i < cum.length - 1 && cum[i] < d) i++;
      const f = (d - cum[i-1]) / (cum[i] - cum[i-1] || 1);
      return [route[i-1][0] + (route[i][0]-route[i-1][0])*f, route[i-1][1] + (route[i][1]-route[i-1][1])*f];
    };

    const DOCK = [532, 834];                                   /* moored hard against the dock's end */
    const SAIL = [[532,834], [700,852], [955,812], [1166,792]];  /* up the river, into the mist */
    const SPEED = 6.5;                                         /* the traveller's walking pace */
    const T_IN = 1.4, T_WALK = total / SPEED, T_BOARD = 3.4, T_WAIT = 3, T_SAIL = 215, T_GONE = 7, T_BACK = 4;
    const CYCLE = T_IN + T_WALK + T_BOARD + T_WAIT + T_SAIL + T_GONE + T_BACK;

    function placeBoat(p, s, op, t, moving){
      const k = moving ? 1 : .7;
      const a = (Math.sin(t*.84)*.8 + Math.sin(t*.37 + 1)*.35) * k;
      const dy = Math.sin(t*.84 + 1.1) * 1.3 * s * k;
      scBoat.setAttribute('transform', `translate(${p[0].toFixed(2)} ${(p[1] + dy).toFixed(2)}) rotate(${a.toFixed(3)}) scale(${s.toFixed(4)})`);
      scBoat.setAttribute('opacity', op.toFixed(3));
    }

    if(STILL){
      placeBoat(DOCK, .78, 1, 0, false);
    } else {
      const rings = []; let nextRing = 0;
      const start = performance.now(); let last = start;

      let lastDraw = 0, paused = 0, pausedAt = 0;
      (function tick(now){
        if(!heroOn){ if(!pausedAt) pausedAt = now; parked.push(tick); return; }        /* the story stops while you scroll */
        if(pausedAt){ paused += now - pausedAt; pausedAt = 0; last = now; }
        if(now - lastDraw < FRAME_MS){ requestAnimationFrame(tick); return; } lastDraw = now;
        const t = (now - start - paused) / 1000, dt = Math.min(.05, (now - last) / 1000); last = now;
        const gust = window.__cxGust || 0;
        let c = t % CYCLE;

        /* pines bend from their trunks; lanterns swing from their cords */
        trees.forEach((el, i) => {
          const a = Math.sin(t*(.55 + i*.13) + i*1.7)*.9 + Math.sin(t*(.23 + i*.07) + i)*.5 + gust*1.4;
          el.setAttribute('transform', `rotate(${a.toFixed(3)} ${el.dataset.px} ${el.dataset.py})`);
        });
        lanterns.forEach((el, i) => {
          const a = Math.sin(t*(1.05 + i*.17) + i*2)*3.2 + Math.sin(t*.37 + i)*1.4 + gust*5;
          el.setAttribute('transform', `rotate(${a.toFixed(2)} ${el.dataset.x} ${el.dataset.y})`);
        });

        /* the story */
        let man = null, manOp = 0, phase = 0, crouch = 0, dip = 0, boatP = DOCK, s = .85, bop = 1, moving = false;
        if(c < T_IN){ man = at(0); manOp = c / T_IN; }
        else if((c -= T_IN) < T_WALK){ const d = c * SPEED; man = at(d); manOp = 1; phase = d * .95; }
        else if((c -= T_WALK) < T_BOARD){
          /* at the end of the dock: he gathers himself, hops up onto the stern deck, the boat dips, he sits */
          const f = c / T_BOARD, e = at(total), deck = [DOCK[0] - 20.3, DOCK[1] - 8.6];
          if(f < .22){ man = e; manOp = 1; crouch = Math.sin(f / .22 * Math.PI) * .2; }
          else if(f < .6){ const h = (f - .22) / .38; man = [e[0] + (deck[0] - e[0])*h, e[1] + (deck[1] - e[1])*h - Math.sin(h*Math.PI)*7]; manOp = 1; }
          else { const h = (f - .6) / .4; man = [deck[0], deck[1] + h*3]; manOp = 1 - h; crouch = Math.min(.35, h*.6); dip = Math.sin(Math.min(1, h / .5) * Math.PI) * 1.3; }
        }
        else if((c -= T_BOARD) < T_WAIT){ /* settling in */ }
        else if((c -= T_WAIT) < T_SAIL){
          const u = c / T_SAIL; let tt = 1 - Math.pow(1 - u, 1.7); if(u < .08) tt *= u / .08;   /* eases off the dock, slows with distance */
          boatP = cb(tt, ...SAIL); s = .78 - .65*tt; moving = true; bop = u > .8 ? Math.max(0, (1 - u) / .2) : 1;
        }
        else if((c -= T_SAIL) < T_GONE){ bop = 0; }
        else { c -= T_GONE; bop = Math.min(1, c / T_BACK); }                                         /* back at the dock */
        placeBoat([boatP[0], boatP[1] + dip], moving ? s : .78, bop, t, moving);

        if(man){
          const sm = .82;
          const sw = Math.sin(phase) * 22, bob = Math.abs(Math.sin(phase)) * .6;
          scMan.setAttribute('transform', `translate(${man[0].toFixed(2)} ${(man[1] - bob).toFixed(2)}) scale(${sm.toFixed(3)} ${(sm*(1 - crouch)).toFixed(3)})`);
          scMan.setAttribute('opacity', manOp.toFixed(3));
          legA.setAttribute('transform', `rotate(${sw.toFixed(1)} 0 -5)`); legB.setAttribute('transform', `rotate(${(-sw).toFixed(1)} 0 -5)`);
        } else scMan.setAttribute('opacity', '0');

        /* ripple rings spread from the boat's waterline */
        if(bop > .05 && t >= nextRing){
          nextRing = t + (moving ? 1.8 : 3.2);
          const e = document.createElementNS(NS, 'ellipse'); ringG.appendChild(e);
          rings.push({e, x: boatP[0], y: boatP[1] + 1, s, op: bop, age: 0});
        }
        for(let i = rings.length - 1; i >= 0; i--){
          const r = rings[i]; r.age += dt; const f = r.age / 3.6;
          if(f >= 1){ r.e.remove(); rings.splice(i, 1); continue; }
          const rx = (10 + 46*f) * r.s;
          r.e.setAttribute('cx', r.x.toFixed(1)); r.e.setAttribute('cy', r.y.toFixed(1));
          r.e.setAttribute('rx', rx.toFixed(2)); r.e.setAttribute('ry', (rx*.16).toFixed(2));
          r.e.setAttribute('stroke-width', (.5 + r.s*.6).toFixed(2)); r.e.setAttribute('opacity', ((1 - f) * .6 * r.op).toFixed(3));
        }

        requestAnimationFrame(tick);
      })(start);
    }
  }
})();
