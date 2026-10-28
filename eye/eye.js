/* THE EYE OF MARKETING — the experience engine.
   One realistic eye artwork (eye-plate.webp) and a camera that travels through it:
   the eye opens, the iris turns, and each chapter flies to its era inside the eye.
   Plain JavaScript and the Web Animations API (transform / opacity / clip-path only),
   no sound, no libraries. Words and settings live in eye-data.js. */
(function () {
  'use strict';
  if (window.__eyeRunning) return; window.__eyeRunning = true;

  var C = window.EYE_CONFIG, CH = window.EYE_CHAPTERS, INTRO = window.EYE_INTRO, REV = window.EYE_REVEAL;
  var html = document.documentElement;
  var qs = new URLSearchParams(location.search);
  var SPEED = Math.max(0.1, +(qs.get('eyespeed') || 1));            /* test helper: /?eye&eyespeed=8 */
  var calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var lite = html.classList.contains('lite');
  var EASE = 'cubic-bezier(.65,0,.35,1)', OUT = 'cubic-bezier(.16,1,.3,1)', IN = 'cubic-bezier(.7,0,.84,0)', BACK = 'cubic-bezier(.34,1.56,.64,1)', FLY = 'cubic-bezier(.76,0,.24,1)';
  var ABORT = { abort: true };
  var store = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

  /* the artwork, in its own pixels */
  var IMG = { w: 1671, h: 941 }, IRIS = { x: 832, y: 467, r: 163 }, PUPIL = { r: 67 }, GLINT = { x: 881, y: 445 };
  var FULL = { x: 834, y: 470, zoom: 1 };
  var S = { chapter: -1, narrating: false, paused: false, ended: false };
  var runId = 0, gates = [], anims = new Set();

  /* -------------------------------------------------------------- DOM */
  var root = document.createElement('div');
  root.className = 'exm' + (lite ? ' lite' : '') + (calm ? ' calm' : '');
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'The Eye of Marketing');
  root.style.setProperty('--plate', 'url("' + C.PLATE + '")');
  root.innerHTML =
    '<div class="ex-stage"><div class="ex-plate">' +
      '<img alt="" src="' + C.PLATE + '" decoding="async" fetchpriority="high">' +
      '<div class="ex-iris"></div><div class="ex-pupil"></div><div class="ex-glint"><i></i><i></i><i></i></div><div class="ex-sweep"></div>' +
      '<svg class="ex-ov" viewBox="0 0 ' + IMG.w + ' ' + IMG.h + '" preserveAspectRatio="none" aria-hidden="false"></svg>' +
      '<div class="ex-lid"></div>' +
    '</div></div>' +
    (lite || calm ? '' : '<canvas class="ex-dust" aria-hidden="true"></canvas>') +
    '<div class="ex-focus"></div><div class="ex-vig"></div>' +
    '<div class="ex-bar t"></div><div class="ex-bar b"></div>' +
    '<div class="ex-smoke" aria-hidden="true"></div>' + (lite || calm ? '' : '<div class="ex-grain"></div>') + '<div class="ex-flash"></div><div class="ex-black"></div>' +
    '<div class="ex-title" aria-live="polite"></div>' +
    '<div class="ex-cap" aria-live="polite"></div>' +
    '<div class="ex-act" role="group" aria-label="Chapter activity"><div class="q"></div><div class="opts"></div><div class="fb" aria-live="polite"></div><div class="go"></div></div>' +
    '<div class="ex-final"></div>' +
    '<div class="ex-hud">' +
      '<div class="ex-tag">THE EYE OF MARKETING</div>' +
      '<div class="ex-chap"><b>CHAPTER <em class="n">01</em> / 07</b><svg class="ex-marks" viewBox="0 0 30 30" aria-hidden="true">' +
        [0, 1, 2, 3, 4, 5, 6].map(function (i) { var a = i / 7 * Math.PI * 2 - Math.PI / 2; return '<circle cx="' + (15 + Math.cos(a) * 11).toFixed(1) + '" cy="' + (15 + Math.sin(a) * 11).toFixed(1) + '" r="2.4"/>'; }).join('') + '</svg></div>' +
      '<button class="ex-skip" type="button">SKIP TO WEBSITE</button>' +
      '<button class="ex-fast" type="button">SKIP ▸▸</button>' +
    '</div>';
  document.body.appendChild(root);
  var $ = function (s) { return root.querySelector(s); };
  var stage = $('.ex-stage'), plate = $('.ex-plate'), img = plate.querySelector('img'), iris = $('.ex-iris'), pupil = $('.ex-pupil'), glint = $('.ex-glint'), sweep = $('.ex-sweep'), ov = $('.ex-ov'), lid = $('.ex-lid');
  var focusEl = $('.ex-focus'), blackEl = $('.ex-black'), titleEl = $('.ex-title'), capEl = $('.ex-cap'), actEl = $('.ex-act'), finalEl = $('.ex-final');
  var NS = 'http://www.w3.org/2000/svg';

  /* film grain: a tiny noise tile made once */
  if (!lite && !calm) {
    try {
      var cv = document.createElement('canvas'); cv.width = cv.height = 96; var cx = cv.getContext('2d'), im = cx.createImageData(96, 96);
      for (var p = 0; p < im.data.length; p += 4) { var v = Math.random() * 255; im.data[p] = im.data[p + 1] = im.data[p + 2] = v; im.data[p + 3] = 255; }
      cx.putImageData(im, 0, 0); $('.ex-grain').style.backgroundImage = 'url(' + cv.toDataURL() + ')';
    } catch (e) {}
  }
  (function () {   /* smoke puffs for the wipes */
    var h = '', n = lite ? 5 : 9;
    for (var i = 0; i < n; i++) { var w = 30 + (i * 37) % 28; h += '<i style="width:' + w + 'vmax;height:' + (w * .8).toFixed(1) + 'vmax;left:' + (i * 13) % 100 + '%;top:' + (6 + (i * 29) % 72) + '%"></i>'; }
    $('.ex-smoke').innerHTML = h;
  })();

  /* ------------------------------------------------------- timing core */
  function wait(ms) {
    var id = runId;
    return new Promise(function (res, rej) {
      var left = ms / SPEED, last = performance.now();
      (function tick() {
        if (id !== runId) return rej(ABORT);
        var now = performance.now(); if (!S.paused) left -= now - last; last = now;
        if (left <= 0) return res();
        setTimeout(tick, Math.min(120, Math.max(16, left)));
      })();
    });
  }
  function gate() { var g = {}; g.p = new Promise(function (res, rej) { g.res = res; g.rej = rej; }); g.open = function (v) { g.res(v); }; gates.push(g); return g; }
  function guard() { var id = runId; return function () { if (id !== runId) throw ABORT; }; }
  function anim(el, kf, o) {
    if (!el || !el.animate) return Promise.resolve();
    o = Object.assign({ duration: 600, easing: EASE, fill: 'forwards' }, o || {});
    o.duration = Math.max(1, o.duration / SPEED); if (o.delay) o.delay /= SPEED;
    if (calm && o.big) o.duration = Math.min(o.duration, 500);
    var a; try { a = el.animate(kf, o); } catch (e) { return Promise.resolve(); }
    anims.add(a); el.__a = a;
    return a.finished.then(function () {
      anims.delete(a);
      if (o.fill === 'forwards' && el.isConnected) { try { a.commitStyles(); a.cancel(); } catch (e) {} }
    }, function () { anims.delete(a); });
  }
  function fadeTo(el, to, dur, o) { return anim(el, [{ opacity: getComputedStyle(el).opacity }, { opacity: to }], Object.assign({ duration: dur || 600 }, o || {})); }

  /* ------------------------------------------------------------ layout */
  var k = 1, pw = 0, ph = 0;
  function layout() {
    var vw = innerWidth, vh = innerHeight;
    pw = vh > vw * 1.05 ? vw * 2.5 : Math.max(vw * 1.05, vh * 1.9);
    ph = pw * IMG.h / IMG.w; k = pw / IMG.w;
    root.style.setProperty('--pw', pw + 'px'); root.style.setProperty('--ph', ph + 'px');
    var d = IRIS.r * 2 * k;
    Object.assign(iris.style, { left: (IRIS.x - IRIS.r) * k + 'px', top: (IRIS.y - IRIS.r) * k + 'px', width: d + 'px', height: d + 'px',
      backgroundSize: pw + 'px ' + ph + 'px', backgroundPosition: -(IRIS.x - IRIS.r) * k + 'px ' + -(IRIS.y - IRIS.r) * k + 'px' });
    var pd = PUPIL.r * 2.2 * k;
    Object.assign(pupil.style, { left: IRIS.x * k - pd / 2 + 'px', top: IRIS.y * k - pd / 2 + 'px', width: pd + 'px', height: pd + 'px' });
    Object.assign(glint.style, { left: GLINT.x * k + 'px', top: GLINT.y * k + 'px' });
    if (!camAnim) stage.style.transform = camT(cam);
  }

  /* ------------------------------------------------------------ camera */
  var cam = { x: FULL.x, y: FULL.y, zoom: 1, rot: 0 }, camAnim = null;
  function camT(c) {
    var tx = -(c.x - IMG.w / 2) * k * c.zoom, ty = -(c.y - IMG.h / 2) * k * c.zoom;
    return 'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px) rotate(' + (c.rot || 0) + 'deg) scale(' + c.zoom + ')';
  }
  /* fly the camera to a point in the artwork; always starts from wherever it is now */
  function camTo(c, dur, ease) {
    var from = getComputedStyle(stage).transform;
    if (camAnim) { try { camAnim.cancel(); } catch (e) {} }
    stage.style.transform = from === 'none' ? camT(cam) : from;
    cam = { x: c.x, y: c.y, zoom: c.zoom, rot: c.rot || 0 };
    var a = stage.animate([{ transform: stage.style.transform }, { transform: camT(cam) }], { duration: Math.max(1, (calm ? Math.min(dur, 600) : dur) / SPEED), easing: ease || EASE, fill: 'forwards' });
    camAnim = a; anims.add(a);
    return a.finished.then(function () { anims.delete(a); if (camAnim === a) { stage.style.transform = camT(cam); a.cancel(); camAnim = null; } }, function () { anims.delete(a); });
  }
  function camSet(c) { if (camAnim) { try { camAnim.cancel(); } catch (e) {} camAnim = null; } cam = { x: c.x, y: c.y, zoom: c.zoom, rot: c.rot || 0 }; stage.style.transform = camT(cam); }
  /* a slow push while the story plays: the image never sits still */
  function drift(ms) { if (calm) return; camTo({ x: cam.x + (Math.random() - .5) * 14, y: cam.y + (Math.random() - .5) * 8, zoom: cam.zoom * 1.06, rot: (cam.rot || 0) * .5 }, ms, 'cubic-bezier(.3,0,.7,1)'); }

  /* --------------------------------------------------------- the living eye */
  var irisSpin = null, pupilAnim = null;
  function eyeAlive() {
    if (irisSpin) return;
    irisSpin = iris.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 140000, iterations: Infinity });
    anims.add(irisSpin);
    if (!calm) {
      pupilAnim = pupil.animate([{ transform: 'scale(.94)' }, { transform: 'scale(1.06)' }], { duration: 5200, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' }); anims.add(pupilAnim);
      var g = glint.animate([{ opacity: .55, transform: 'scale(.85) rotate(0deg)' }, { opacity: 1, transform: 'scale(1.1) rotate(8deg)' }], { duration: 2600, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' }); anims.add(g);
    }
  }
  /* spin the iris hard for a moment (a time-travel jolt), then settle */
  function irisRush(ms) {
    if (!irisSpin || calm) return;
    try { irisSpin.updatePlaybackRate(70); } catch (e) { irisSpin.playbackRate = 70; }
    setTimeout(function () { try { irisSpin.updatePlaybackRate(1); } catch (e) { irisSpin.playbackRate = 1; } }, (ms || 1400) / SPEED);
  }
  function pupilKick(s) { if (calm) return; anim(pupil, [{ transform: 'scale(1)' }, { transform: 'scale(' + (s || 1.35) + ')', offset: .35 }, { transform: 'scale(1)' }], { duration: 1600, fill: 'none', composite: 'add', easing: EASE }); }
  function sweepLight(dur) { anim(sweep, [{ opacity: 0, backgroundPosition: '100% 0' }, { opacity: 1, offset: .25 }, { opacity: 1, offset: .75 }, { opacity: 0, backgroundPosition: '-50% 0' }], { duration: dur || 2400, fill: 'none', easing: 'cubic-bezier(.4,0,.6,1)' }); }
  function flash(v) { if (!calm) anim($('.ex-flash'), [{ opacity: 0 }, { opacity: v || .5, offset: .12 }, { opacity: 0 }], { duration: 900, fill: 'none' }); }
  async function smokeWipe() {
    if (calm) return;
    await anim($('.ex-smoke'), [{ opacity: 0, transform: 'translateX(-55%) scale(1.1)' }, { opacity: 1, offset: .38 }, { opacity: 1, offset: .62 }, { opacity: 0, transform: 'translateX(55%) scale(1)' }], { duration: 1700, easing: 'cubic-bezier(.5,0,.5,1)', fill: 'none' });
  }
  function shake(amt) { if (calm) return; amt = amt || 5; anim(plate, [{ transform: 'translate(0,0)' }, { transform: 'translate(' + amt + 'px,' + (-amt / 2) + 'px)' }, { transform: 'translate(' + (-amt) + 'px,' + amt / 2 + 'px)' }, { transform: 'translate(0,0)' }], { duration: 280, fill: 'none' }); }

  /* floating dust in the light */
  var dustOn = false;
  function dust() {
    var c = $('.ex-dust'); if (!c) return; var g = c.getContext('2d'), ps = [], n = 70, W, H;
    function size() { W = c.width = innerWidth; H = c.height = innerHeight; }
    size(); addEventListener('resize', size);
    for (var i = 0; i < n; i++) ps.push({ x: Math.random(), y: Math.random(), r: .4 + Math.random() * 1.8, vx: (Math.random() - .5) * .00012, vy: -.00004 - Math.random() * .00012, t: Math.random() * 6 });
    dustOn = true;
    (function frame(ts) {
      if (!dustOn) return;
      if (!S.paused) {
        g.clearRect(0, 0, W, H);
        for (var i = 0; i < n; i++) {
          var p = ps[i]; p.x += p.vx * 16; p.y += p.vy * 16; p.t += .016;
          if (p.y < -.02) { p.y = 1.02; p.x = Math.random(); } if (p.x < -.02) p.x = 1.02; if (p.x > 1.02) p.x = -.02;
          g.globalAlpha = .18 + .32 * (.5 + .5 * Math.sin(p.t * 1.3));
          g.fillStyle = '#f5dca8'; g.beginPath(); g.arc(p.x * W, p.y * H, p.r, 0, 6.283); g.fill();
        }
      }
      requestAnimationFrame(frame);
    })();
  }

  /* --------------------------------------------------------- story lines */
  var fastReq = false;
  function parse(line) { var m = line.match(/\s*\{(\w+)\}\s*$/); return { text: m ? line.slice(0, m.index) : line, beat: m ? m[1] : null }; }
  function words(t) { return t.split(/\s+/).filter(Boolean).length; }
  var esc = function (t) { return t.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); };
  function caption(text) {
    var old = capEl.querySelector('span');
    if (old) { var o = old; anim(o, [{ opacity: 1, transform: 'none', filter: 'blur(0px)' }, { opacity: 0, transform: 'translateY(-14px)', filter: 'blur(6px)' }], { duration: 380, fill: 'forwards' }).then(function () { o.remove(); }); }
    if (!text) return;
    var sp = document.createElement('span'); sp.style.position = old ? 'absolute' : ''; sp.style.left = '0'; sp.style.right = '0'; sp.style.bottom = '0';
    sp.innerHTML = text.split(/(\s+)/).map(function (w) { return /^\s+$/.test(w) ? w : '<span class="w">' + esc(w) + '</span>'; }).join('');
    capEl.appendChild(sp);
    sp.querySelectorAll('.w').forEach(function (w, i) {
      anim(w, [{ opacity: 0, transform: 'translateY(.45em)', filter: 'blur(10px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { duration: 760, delay: 140 + i * 55, easing: OUT });
    });
    setTimeout(function () { sp.style.position = ''; }, 420 / SPEED);
  }
  async function narrate(lines, onBeat) {
    var check = guard(), items = lines.map(parse), fired = {};
    S.narrating = true; fastReq = false; root.classList.add('fast-on');
    for (var i = 0; i < items.length && !fastReq; i++) {
      caption(items[i].text);
      if (items[i].beat && onBeat) { fired[items[i].beat] = 1; try { onBeat(items[i].beat, false); } catch (e) {} }
      var left = Math.max(1700, words(items[i].text) * C.WORD_MS + 900);
      while (left > 0 && !fastReq) { await wait(Math.min(100, left)); left -= 100; }
      check();
    }
    if (fastReq && onBeat) for (var j = i; j < items.length; j++) if (items[j].beat && !fired[items[j].beat]) { try { onBeat(items[j].beat, true); } catch (e) {} }
    caption(''); S.narrating = false; root.classList.remove('fast-on');
  }

  /* ---------------------------------------------------------- title card */
  async function titleCard(o) {
    var letters = function (t) { return t.split(' ').map(function (w) { return '<span class="w">' + w.split('').map(function (ch) { return '<span class="l">' + esc(ch) + '</span>'; }).join('') + '</span>'; }).join(' '); };
    titleEl.innerHTML = (o.kicker ? '<small>' + o.kicker + '</small>' : '') +
      '<h2><svg class="brush" viewBox="0 0 100 10" preserveAspectRatio="none"><path pathLength="1" d="M2 6 C 30 2, 60 9, 98 4"/></svg>' + letters(o.title) + '</h2>' + (o.sub ? '<p>' + o.sub + '</p>' : '');
    titleEl.style.opacity = 1; titleEl.style.transform = '';
    var small = titleEl.querySelector('small'), ls = titleEl.querySelectorAll('.l'), brush = titleEl.querySelector('.brush path'), sub = titleEl.querySelector('p');
    if (small) anim(small, [{ opacity: 0, letterSpacing: '.9em' }, { opacity: 1, letterSpacing: '.5em' }], { duration: 1000, easing: OUT });
    ls.forEach(function (l, i) { anim(l, [{ opacity: 0, transform: 'translateY(60%) rotate(8deg) scale(1.2)', filter: 'blur(8px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { duration: 800, delay: 200 + i * 34, easing: OUT }); });
    anim(brush, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 1000, delay: 300 + ls.length * 22, easing: OUT });
    if (sub) anim(sub, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 900, delay: 700 + ls.length * 30 });
    flash(.25);
    await wait(o.hold || 2600);
  }
  function titleOut() { return anim(titleEl, [{ opacity: 1, transform: 'none', filter: 'blur(0px)' }, { opacity: 0, transform: 'scale(1.06)', filter: 'blur(8px)' }], { duration: 650, fill: 'none' }).then(function () { titleEl.style.opacity = 0; titleEl.innerHTML = ''; }); }

  /* --------------------------------------------------------------- HUD */
  $('.ex-fast').addEventListener('click', function () { fastReq = true; });
  $('.ex-skip').addEventListener('click', function () { close('skip'); });
  function hud(i) {
    $('.ex-chap .n').textContent = ('0' + (i + 1)).slice(-2);
    root.querySelectorAll('.ex-marks circle').forEach(function (c, n) { c.classList.toggle('on', n < i); c.classList.toggle('now', n === i); });
    root.classList.add('hud-on');
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root.isConnected) close('skip'); });
  document.addEventListener('visibilitychange', function () {
    S.paused = document.hidden;
    anims.forEach(function (a) { try { document.hidden ? a.pause() : a.play(); } catch (e) {} });
  });
  addEventListener('resize', layout);

  /* -------------------------------------------------------- activities */
  function svg(tag, attrs, parent) { var e = document.createElementNS(NS, tag); for (var a in attrs) e.setAttribute(a, attrs[a]); (parent || ov).appendChild(e); return e; }
  function actReset() { actEl.querySelector('.q').textContent = ''; actEl.querySelector('.opts').innerHTML = ''; var fb = actEl.querySelector('.fb'); fb.textContent = ''; fb.className = 'fb'; actEl.querySelector('.go').innerHTML = ''; }
  function feedback(t, soft) { var fb = actEl.querySelector('.fb'); fb.className = 'fb' + (soft ? ' soft' : ''); fb.textContent = t; anim(fb, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 500, easing: OUT }); }
  function btn(label, cls) { var b = document.createElement('button'); b.type = 'button'; b.className = 'ex-btn ' + (cls || ''); b.innerHTML = label; return b; }
  function optBtn(label) { var b = document.createElement('button'); b.type = 'button'; b.className = 'ex-opt'; b.textContent = label; return b; }
  function asButton(el, label, fn) {
    el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0'); el.setAttribute('aria-label', label);
    el.addEventListener('click', fn); el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
  }
  /* a soft light that blooms on a spot in the artwork */
  function bloom(x, y, r, peak, dur) {
    var c = svg('circle', { class: 'glow', cx: x, cy: y, r: r || 40 }); c.style.filter = 'blur(' + ((r || 40) / 3) + 'px)';
    return anim(c, [{ opacity: 0 }, { opacity: peak || .55, offset: .3 }, { opacity: 0 }], { duration: (dur || 1400) * 1.6, easing: OUT, fill: 'none' }).then(function () { c.remove(); });
  }
  function waves(x, y, n, r) {
    for (var i = 0; i < (n || 3); i++) { var w = svg('circle', { class: 'wave', cx: x, cy: y, r: r || 22 }); anim(w, [{ opacity: .9, transform: 'scale(.3)' }, { opacity: 0, transform: 'scale(3.2)' }], { duration: 1800, delay: i * 380, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'none' }); }
  }

  var ACT = {
    choice: function (def) {
      return new Promise(function (done) {
        var box = actEl.querySelector('.opts'), solved = false;
        def.options.forEach(function (o, i) {
          var b = optBtn(String.fromCharCode(65 + i) + '.  ' + o); box.appendChild(b);
          b.addEventListener('click', function () {
            if (solved) return;
            if (i === def.correct) {
              solved = true; b.classList.add('right'); b.insertAdjacentHTML('afterbegin', '<span class="tick">✓</span>');
              box.querySelectorAll('.ex-opt').forEach(function (x) { x.disabled = true; });
              feedback(def.right); bloom(cam.x, cam.y, 90, .45, 1800); flash(.25); done();
            } else { b.classList.add('wrong'); feedback(def.wrong, true); setTimeout(function () { b.classList.remove('wrong'); }, 900); }
          });
        });
      });
    },
    pass: function (def) {
      return new Promise(function (done) {
        var step = 0, hots = [];
        def.points.forEach(function (pt, i) {
          var g = svg('g', { class: 'hot' + (i === 0 ? ' next' : '') });
          svg('circle', { cx: pt[0], cy: pt[1], r: 24, fill: 'transparent' }, g);
          svg('circle', { class: 'pulse', cx: pt[0], cy: pt[1], r: 12 }, g);
          svg('circle', { class: 'ring', cx: pt[0], cy: pt[1], r: 11 }, g);
          svg('circle', { class: 'core', cx: pt[0], cy: pt[1], r: 4.5 }, g);
          hots.push(g);
          asButton(g, 'Person ' + (i + 1), function () {
            if (step >= hots.length || g.classList.contains('done')) return;
            if (i !== step) { feedback(def.hint, true); return; }
            g.classList.remove('next'); g.classList.add('done'); bloom(pt[0], pt[1], 30, .7, 900);
            if (i > 0) {
              var a = def.points[i - 1], mx = (a[0] + pt[0]) / 2, my = Math.min(a[1], pt[1]) - 34;
              var path = svg('path', { class: 'trail', d: 'M' + a[0] + ' ' + a[1] + ' Q' + mx + ' ' + my + ' ' + pt[0] + ' ' + pt[1], pathLength: 1 });
              anim(path, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 700, easing: OUT });
            }
            step++;
            if (step < hots.length) hots[step].classList.add('next');
            else { feedback(def.done); waves(pt[0], pt[1], 3, 16); done(); }
          });
        });
      });
    },
    print: function (def) {
      return new Promise(function (done) {
        var b = btn(def.button + ' <span class="arr">⎙</span>', 'pri'); actEl.querySelector('.opts').appendChild(b);
        b.addEventListener('click', async function () {
          b.disabled = true; shake(6); flash(.4); bloom(def.from[0], def.from[1], 90, .6, 1600);
          for (var i = 0; i < 16; i++) {
            var s = document.createElement('div'); s.className = 'ex-sheet'; root.appendChild(s);
            var ang = (i / 16) * Math.PI * 2 + Math.random() * .4, dist = 38 + Math.random() * 30;
            var tx = Math.cos(ang) * dist + 'vw', ty = Math.sin(ang) * dist * .7 + 'vh', rz = (Math.random() * 120 - 60).toFixed(0);
            (function (s) {
              anim(s, [{ opacity: 0, transform: 'translate(0,0) rotate(0deg) scale(.3)' }, { opacity: 1, transform: 'translate(0,0) rotate(0deg) scale(1)', offset: .12 },
                { opacity: 1, transform: 'translate(' + tx + ',' + ty + ') rotate(' + rz + 'deg) scale(.9)', offset: .8 }, { opacity: 0, transform: 'translate(' + tx + ',' + ty + ') rotate(' + rz + 'deg) scale(.85)' }],
                { duration: 1900, delay: i * 70, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'none' }).then(function () { s.remove(); });
            })(s);
          }
          await wait(1400); feedback(def.done); done();
        });
      });
    },
    media: function (def) {
      return new Promise(function (done) {
        var box = actEl.querySelector('.opts'), solved = false, r = optBtn('◉  ' + def.radio), t = optBtn('▣  ' + def.tv);
        box.appendChild(r); box.appendChild(t);
        function finish() { if (solved) return; solved = true; setTimeout(function () { feedback(def.done); done(); }, 1100 / SPEED); }
        r.addEventListener('click', function () { r.classList.add('picked'); var s = def.screens[1]; waves(s[0], s[1], 4, 26); bloom(s[0], s[1], 60, .5, 1600); finish(); });
        t.addEventListener('click', function () {
          t.classList.add('picked'); flash(.3);
          def.screens.forEach(function (s, i) {
            var rc = svg('rect', { class: 'glow', x: s[0] - s[2] / 2, y: s[1] - s[3] / 2, width: s[2], height: s[3], rx: 4 }); rc.style.filter = 'blur(4px)';
            anim(rc, [{ opacity: 0 }, { opacity: .7, offset: .1 }, { opacity: .15, offset: .2 }, { opacity: .6, offset: .32 }, { opacity: .32 }], { duration: 1400, delay: i * 180 });
          });
          finish();
        });
      });
    },
    channels: function (def) {
      return new Promise(function (done) {
        var box = actEl.querySelector('.opts'), solved = false;
        def.options.forEach(function (o) {
          var b = optBtn(o.label); b.setAttribute('aria-pressed', 'false'); box.appendChild(b);
          b.addEventListener('click', async function () {
            if (b.classList.contains('picked')) return;
            b.classList.add('picked'); b.setAttribute('aria-pressed', 'true');
            bloom(o.at[0], o.at[1], 34, .7, 1200); waves(o.at[0], o.at[1], 2, 14);
            if (!solved) { solved = true; await wait(800); feedback(def.done); done(); }
          });
        });
      });
    },
    rings: function (def) {
      return new Promise(function (done) {
        var seen = {}, c = def.centre, gs = [];
        def.rings.forEach(function (r, i) {
          var g = svg('g', { class: 'rg' });
          var line = svg('circle', { class: 'line', cx: c[0], cy: c[1], r: r.r, pathLength: 1 }, g);
          svg('circle', { class: 'hit', cx: c[0], cy: c[1], r: r.r }, g);
          var la = -0.62, tx = svg('text', { x: c[0] + Math.cos(la) * r.r + 10, y: c[1] + Math.sin(la) * r.r - 4, 'text-anchor': 'start' }, g); tx.textContent = r.label;
          line.style.strokeDasharray = 1; line.style.strokeDashoffset = 1; tx.style.opacity = 0;
          anim(line, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 1300, delay: i * 250, easing: OUT });
          anim(tx, [{ opacity: 0 }, { opacity: .75 }], { duration: 700, delay: 600 + i * 250 });
          gs.push(g);
          asButton(g, r.label, function () {
            feedback(r.text);
            if (seen[r.id]) return;
            seen[r.id] = 1; g.classList.add('on'); bloom(c[0], c[1] - r.r, 26, .8, 900);
            if (Object.keys(seen).length === def.rings.length) setTimeout(async function () {
              irisRush(1600); pupilKick(1.5); flash(.35);
              gs.forEach(function (x, n) { x.style.transformBox = 'view-box'; x.style.transformOrigin = c[0] + 'px ' + c[1] + 'px'; anim(x, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.35)' }], { duration: 1400, delay: n * 120, easing: EASE }); });
              await wait(1300); feedback('NOTICE → REMEMBER → CONSIDER'); await wait(1600); feedback(def.done); done();
            }, 800 / SPEED);
          });
        });
      });
    },
  };

  async function activity(n, def) {
    var check = guard();
    actReset(); actEl.querySelector('.q').textContent = def.prompt;
    var go = btn(n === 7 ? 'Discover Clipency <span class="arr">→</span>' : 'Continue the journey <span class="arr">→</span>', 'pri');
    go.disabled = true; actEl.querySelector('.go').appendChild(go);
    root.classList.add('act-on');
    var g = gate();
    await Promise.race([ACT[def.type](def), g.p]); check();
    go.disabled = false; go.classList.add('ready');
    if (!calm) anim(go, [{ transform: 'scale(.94)', opacity: .4 }, { transform: 'scale(1)', opacity: 1 }], { duration: 600, easing: BACK, fill: 'none' });
    try { go.focus({ preventScroll: true }); } catch (e) {}
    var clicked = false;
    go.addEventListener('click', function () { if (clicked) return; clicked = true; go.disabled = true; g.open(); });
    await g.p; check();
    root.classList.remove('act-on');
  }

  /* ----------------------------------------------------------- the flow */
  function setClip(ry, rx) { plate.style.clipPath = 'ellipse(' + (rx || 44) + '% ' + ry + '% at 49.8% 49.7%)'; }
  function clipTo(ry, dur, ease, rx) {
    var from = plate.style.clipPath || 'ellipse(44% 0% at 49.8% 49.7%)', to = 'ellipse(' + (rx || 44) + '% ' + ry + '% at 49.8% 49.7%)';
    return anim(plate, [{ clipPath: from }, { clipPath: to }], { duration: dur, easing: ease || EASE });
  }

  async function opening() {
    var check = guard();
    setClip(0); lid.style.opacity = .85; camSet({ x: IRIS.x, y: IRIS.y, zoom: 1.5 });
    try { await Promise.race([img.decode(), new Promise(function (r) { setTimeout(r, 4000); })]); } catch (e) {}
    await wait(1400); check();
    root.classList.add('skip-on');
    /* the first, uncertain opening */
    fadeTo(lid, .45, 1600);
    await clipTo(7, 1500, 'cubic-bezier(.3,.1,.3,1)'); check();
    eyeAlive();
    await wait(600);
    await clipTo(0, 240, IN); check();                       /* … and a blink */
    fadeTo(lid, .9, 240);
    await wait(800); check();
    /* the real opening */
    camTo({ x: FULL.x, y: FULL.y, zoom: 1 }, 5200, 'cubic-bezier(.25,.1,.25,1)');
    fadeTo(lid, 0, 2400);
    await clipTo(40, 1700, OUT); check();
    plate.style.clipPath = ''; flash(.3); sweepLight(2600); pupilKick(1.25);
    if (!calm) dust();
    await wait(1800); check();
  }

  async function intro() {
    var check = guard();
    await narrate(INTRO.open, function (b, quick) {
      if (quick) return;
      if (b === 'modern') camTo({ x: 1225, y: 500, zoom: 1.7, rot: -1.2 }, 2600, FLY);
      if (b === 'ancient') camTo({ x: 420, y: 440, zoom: 1.7, rot: 1.2 }, 2800, FLY);
      if (b === 'ring') { camTo({ x: IRIS.x, y: IRIS.y, zoom: 1.6 }, 2600, FLY); irisRush(1800); sweepLight(2600); }
    });
    check();
    await narrate(INTRO.reveal, async function (b, quick) {
      if (b === 'title') {
        camTo({ x: FULL.x, y: FULL.y, zoom: 1.05 }, 2400, FLY); irisRush(1200); pupilKick(1.4); flash(.45); sweepLight(2600);
        titleCard({ title: 'THE EYE OF MARKETING', sub: 'A journey through the evolution of human attention.', hold: 10 });
      } else if (!quick) { drift(5000); }
    });
    check();
  }

  async function beginButton() {
    var g = gate(); actReset();
    var b = btn('Begin the journey <span class="arr">→</span>', 'pri ready');
    actEl.querySelector('.go').appendChild(b); root.classList.add('act-on');
    try { b.focus({ preventScroll: true }); } catch (e) {}
    b.onclick = function () { b.disabled = true; g.open(); };
    await g.p; root.classList.remove('act-on');
    await titleOut();
  }

  async function chapter(i) {
    var check = guard(), ch = CH[i], f = ch.focus;
    S.chapter = i; hud(i);
    root.classList.add('films');
    /* time-travel: the iris spins, the camera pulls into the pupil, then flies to the era */
    irisRush(1600); pupilKick(1.4);
    await camTo({ x: IRIS.x, y: IRIS.y, zoom: 1.35 }, 900, IN); check();
    smokeWipe(); flash(.35);
    await camTo({ x: f.x, y: f.y, zoom: f.zoom, rot: i % 2 ? -1.4 : 1.4 }, 2600, FLY); check();
    fadeTo(focusEl, 1, 1200);
    camTo({ x: f.x, y: f.y, zoom: f.zoom * 1.04, rot: 0 }, 3400, OUT);
    await titleCard({ kicker: 'CHAPTER ' + ('0' + ch.id).slice(-2), title: ch.title, sub: ch.subtitle, hold: 2400 }); check();
    await titleOut();
    var lineNo = 0;
    await narrate(ch.narration, function (b, quick) {
      if (quick) return;
      if (b === 'settle') { camTo({ x: f.x, y: f.y, zoom: f.zoom, rot: 0 }, 2200, EASE); return; }
      lineNo++;
      camTo({ x: f.x + (lineNo % 2 ? 18 : -18), y: f.y + (lineNo % 3 ? -8 : 8), zoom: f.zoom * (1.08 + (lineNo % 3) * .04), rot: lineNo % 2 ? .8 : -.8 }, 3200, OUT);
      bloom(f.x, f.y, 70, .3, 1800);
    });
    check();
    await activity(ch.id, ch.activity); check();
    root.querySelectorAll('.ex-marks circle')[i].classList.add('on');
    /* back out to the whole eye */
    fadeTo(focusEl, 0, 900);
    smokeWipe();
    await camTo({ x: FULL.x, y: FULL.y, zoom: 1.02 }, 2000, FLY); check();
    ov.innerHTML = '';
  }

  async function reveal() {
    var check = guard();
    root.classList.remove('hud-on', 'films');
    fadeTo(focusEl, 0, 600);
    await camTo({ x: IRIS.x, y: IRIS.y, zoom: 1.5 }, 1800, FLY); check();
    irisRush(3000); sweepLight(2400); pupilKick(1.5);
    await wait(1600); check();
    /* dive into the pupil */
    var dive = Math.max(innerWidth, innerHeight) / (PUPIL.r * 2 * k) * 1.6;
    camTo({ x: IRIS.x, y: IRIS.y, zoom: dive }, 2400, 'cubic-bezier(.6,0,.9,.4)');
    await wait(1900); check();
    await fadeTo(blackEl, 1, 500); check();
    camSet({ x: FULL.x, y: FULL.y, zoom: 1.15 }); plate.style.opacity = .2; dustOn && (root.querySelector('.ex-dust').style.opacity = .6);
    flash(.6);
    finalEl.innerHTML = '<img class="ex-logo" src="' + C.LOGO + '" alt="Clipency" width="342" height="78"><div class="ex-tagline">THE VIRAL CONTENT NETWORK</div>' +
      '<div class="ex-lines">' + REV.lines.map(function (l) { return '<div>' + l + '</div>'; }).join('') + '</div>' +
      '<p class="ex-support">' + REV.support + '</p><div class="ex-ctas"></div><button class="ex-again" type="button">↻ Watch the journey again</button>';
    var logo = finalEl.querySelector('.ex-logo');
    logo.onerror = function () { logo.outerHTML = '<div class="ex-logo" style="font:600 clamp(34px,6vw,64px)/1 Inter,sans-serif;letter-spacing:.32em;opacity:1">CLIPENCY</div>'; };
    fadeTo(blackEl, 0, 2400);
    camTo({ x: FULL.x, y: FULL.y, zoom: 1 }, 14000, 'linear');
    anim(logo, [{ opacity: 0, transform: 'scale(1.15)', filter: 'blur(14px) brightness(3)' }, { opacity: 1, transform: 'scale(1)', filter: 'blur(0px) brightness(1)' }], { duration: 2000, easing: OUT });
    anim(finalEl.querySelector('.ex-tagline'), [{ opacity: 0, letterSpacing: '1.1em' }, { opacity: 1, letterSpacing: '.5em' }], { duration: 1800, delay: 600, easing: OUT });
    await wait(2200); check();
    await narrate(REV.narration, null); check();
    var ls = finalEl.querySelectorAll('.ex-lines div');
    for (var i = 0; i < ls.length; i++) { anim(ls[i], [{ opacity: 0, transform: 'translateY(22px)', filter: 'blur(10px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { duration: 1000, easing: OUT }); await wait(1300); }
    anim(finalEl.querySelector('.ex-support'), [{ opacity: 0 }, { opacity: 1 }], { duration: 900 });
    var ctas = finalEl.querySelector('.ex-ctas');
    var book = document.createElement('a'); book.className = 'ex-btn pri ready'; book.href = C.BOOKING_URL; book.target = '_blank'; book.rel = 'noopener'; book.innerHTML = REV.primary + ' <span class="arr">→</span>';
    var enter = btn(REV.secondary, 'ghost');
    ctas.appendChild(book); ctas.appendChild(enter);
    book.addEventListener('click', markSeen);
    enter.addEventListener('click', function () { close('enter'); });
    finalEl.querySelector('.ex-again').addEventListener('click', function () { location.href = '/?eye'; });
    await wait(400);
    anim(ctas, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 900, easing: OUT });
    anim(finalEl.querySelector('.ex-again'), [{ opacity: 0 }, { opacity: 1 }], { duration: 900, delay: 900 });
    finalEl.classList.add('on'); S.ended = true; markSeen();
    try { book.focus({ preventScroll: true }); } catch (e) {}
  }

  /* -------------------------------------------------------------- leave */
  function markSeen() { store.set('cx-eye-seen', String(Date.now())); }
  function close() {
    if (!root.isConnected || root.classList.contains('out')) return;
    runId++; gates.forEach(function (g) { try { g.rej(ABORT); } catch (e) {} }); gates = [];
    dustOn = false; markSeen();
    root.classList.add('out'); html.classList.remove('eye-on');
    setTimeout(function () { anims.forEach(function (a) { try { a.cancel(); } catch (e) {} }); anims.clear(); root.remove(); window.__eyeRunning = false; scrollTo(0, 0); }, 950);
    if (qs.has('eye')) { try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {} }
  }
  window.CXEye = { close: close, state: S };

  /* ---------------------------------------------------------------- run */
  layout();
  (async function main() {
    try {
      var start = Math.min(CH.length, Math.max(0, (+qs.get('eyech') || 1) - 1));   /* test helper: /?eye&eyech=7 */
      await opening();
      if (!start) { await intro(); await beginButton(); }
      for (var i = start; i < CH.length; i++) await chapter(i);
      await reveal();
    } catch (e) { if (e !== ABORT) { console.error('[eye]', e); close(); } }
  })();
})();
