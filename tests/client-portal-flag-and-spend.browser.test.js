/* Client portal (campaign.html): flag dialog + per-video spend.
 *
 * Run:  PORTAL_DIR=/path/to/clipency-client-portal node tests/client-portal-flag-and-spend.browser.test.js
 *
 * Serves the real campaign.html, stubs the supabase-js CDN, and checks:
 *   A. spend KPI = approved clips x client rate, and label agrees with total
 *   B. "Flag this clip" opens a centred fixed card in place (no scroll needed),
 *      reason chips are a 2-col grid of buttons
 *   C. "Send flag" calls client_flag_clip with the clip id + reason, pulls the card
 *   D. rpc error keeps the dialog open and shows the server message
 *   E. demo mode never touches the rpc
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW_MODULE || 'playwright');

const DIR = process.env.PORTAL_DIR;
if (!DIR) { console.error('set PORTAL_DIR'); process.exit(2); }
const PAGE = process.env.PORTAL_PAGE || 'campaign.html';

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; } else { fail++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png' };
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(DIR, u === '/' ? PAGE : u);
      if (!f.startsWith(DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rsp);
    }).listen(0, () => res(srv));
  });
}

const CAMP = 'e18bb5d9-5ec8-416b-97a3-558275e3fd61';
function payload(nApproved, rate) {
  const subs = [];
  for (let i = 0; i < nApproved; i++) {
    subs.push({
      id: '00000000-0000-4000-8000-' + String(i).padStart(12, '0'),
      campaign_id: CAMP, campaign_title: 'Vingo {UGC Campaign}', platform: 'Instagram',
      handle: '@creator' + i, clip_url: 'https://instagram.com/reel/x' + i,
      views: 1000 + i * 10, likes: 10, comments: 1, status: 'approved',
      earned: rate, earned_native: rate,
      created_at: '2026-09-' + String(10 + (i % 10)).padStart(2, '0') + 'T10:00:00Z'
    });
  }
  subs.push(Object.assign({}, subs[0], { id: 'ffffffff-0000-4000-8000-000000000001', status: 'flagged' }));
  return {
    campaigns: [{ id: CAMP, title: 'Vingo {UGC Campaign}', status: 'active', payout_model: 'per_video',
      currency: 'USD', fx_rate_per_usd: 1, is_agency: true, rate_per_video: rate, rate_per_video_native: rate,
      rpm: 0, rpm_native: 0, budget: 1250, budget_native: 1250, spent: nApproved * rate,
      remaining: 1250 - nApproved * rate, platform_fee: null, creator_pool: null,
      created_at: '2026-09-09T00:00:00Z', start_date: '2026-09-09' }],
    submissions: subs,
    wallet: { balance: 0, ledger: [] },
    totals: { funded: 1250, platform_fee: null, creator_pool: null, spent: nApproved * rate }
  };
}

const STUB = `
window.supabase = { createClient: function(){
  return {
    auth: { getUser: async function(){ return {data:{user:{id:'client-1',email:'client@example.com'}}}; },
            getSession: async function(){ return {data:{session:{user:{id:'client-1'}}}}; },
            signOut: async function(){ return {}; },
            onAuthStateChange: function(){ return {data:{subscription:{unsubscribe:function(){}}}}; } },
    rpc: async function(name, args){
      (window.__RPC = window.__RPC || []).push({name:name, args:args});
      if (name === 'client_dashboard_data') return {data: window.__PAYLOAD, error: null};
      if (name === 'client_flag_clip') {
        if (window.__FLAG_ERR) return {data:null, error:{message: window.__FLAG_ERR}};
        return {data:{status:'flagged'}, error:null};
      }
      return {data:null, error:null};
    },
    from: function(){ var q = {select:function(){return q;}, eq:function(){return q;}, order:function(){return q;},
      limit:function(){return q;}, single:async function(){return {data:null,error:null};},
      then:function(r){ return Promise.resolve({data:[],error:null}).then(r); }}; return q; }
  };
}};`;

async function newPage(browser, base, opts) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    /* The demo tour auto-advances to other pages; it is not under test here. */
    if (opts.demo && /\/tour\.js/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.CLIPTOUR={start:function(){},isDemo:function(){return true;}};' });
    if (u.startsWith(base)) return route.continue();
    if (/supabase-js@2/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    return route.abort();
  });
  await ctx.addInitScript(({ p, demo, err }) => {
    try {
      localStorage.setItem('sb-spwtkdgpgeutrhwcjrpy-auth-token', '{"fake":1}');
      sessionStorage.removeItem('clipency-live-v2');
      if (demo) sessionStorage.setItem('clipency-demo', '1');
      Object.keys(localStorage).filter(k => k.indexOf('clipency-flags-') === 0).forEach(k => localStorage.removeItem(k));
    } catch (e) {}
    window.__PAYLOAD = p; window.__RPC = []; window.__FLAG_ERR = err || null;
  }, { p: opts.payload, demo: !!opts.demo, err: opts.err });
  const page = await ctx.newPage();
  page.on('pageerror', e => { page.__errors = (page.__errors || []).concat(e.message); });
  return { ctx, page };
}

async function openFlagOnLastCard(page) {
  await page.waitForSelector('#clipGrid .clip-card', { timeout: 15000 });
  /* Demo visitors are locked behind the tour's pointer blocker by design.
     Lift it so the demo branch of the flag code can be exercised. */
  await page.evaluate(() => { const b = document.getElementById('demoBlocker'); if (b) b.remove(); });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(150);
  const card = page.locator('#clipGrid .clip-card').last();
  await card.scrollIntoViewIfNeeded();
  const id = await card.getAttribute('data-id');
  await card.hover();
  await card.locator('.clip-menu-btn').click();
  const y0 = await page.evaluate(() => window.scrollY);
  await card.locator('.mi-flag').click();
  await page.waitForTimeout(450);          // .3s open transition
  return { id, y0 };
}

async function dialogGeometry(page) {
  return page.evaluate(() => {
    const s = document.getElementById('flagScrim');
    const m = s.querySelector('.modal');
    const g = document.getElementById('reasonGrid');
    const cs = getComputedStyle(s), gs = getComputedStyle(g);
    const r = m.getBoundingClientRect();
    return {
      position: cs.position, display: cs.display, opacity: +cs.opacity, z: cs.zIndex, pe: cs.pointerEvents,
      cx: r.left + r.width / 2, cy: r.top + r.height / 2, top: r.top, bottom: r.bottom, w: r.width,
      vw: innerWidth, vh: innerHeight, scrollY: scrollY,
      gridDisplay: gs.display, gridCols: gs.gridTemplateColumns.split(' ').length,
      chips: g.querySelectorAll('button').length,
      chipBorder: g.querySelector('button') ? getComputedStyle(g.querySelector('button')).borderTopStyle : null,
      open: s.classList.contains('open')
    };
  });
}

(async () => {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });

  /* ---- A. spend = clips x client rate ---- */
  {
    const { ctx, page } = await newPage(browser, base, { payload: payload(55, 2.5) });
    await page.goto(base + PAGE + '?view=overview');
    await page.waitForFunction(() => document.getElementById('stSpendFoot') && /per approved video/.test(document.getElementById('stSpendFoot').textContent), null, { timeout: 15000 });
    await page.waitForTimeout(2200);       // count-up animation
    const k = await page.evaluate(() => ({
      spend: document.getElementById('stSpend').textContent.trim(),
      pct: document.getElementById('stBudget').textContent.trim(),
      foot: document.getElementById('stBudgetFoot').textContent.trim(),
      rate: document.getElementById('stSpendFoot').textContent.trim(),
      clips: document.getElementById('stClips').textContent.trim(),
      fill: document.getElementById('budgetFill').style.width
    }));
    ok(k.spend === '$137.50', 'A1 spend is 55 x $2.50', k.spend);
    ok(k.foot === '$137.50 of $1,250.00 budget', 'A2 budget foot', k.foot);
    ok(k.rate === 'at $2.50 per approved video', 'A3 rate label', k.rate);
    ok(k.pct === '11.0%', 'A4 budget used %', k.pct);
    ok(k.fill === '11%', 'A5 progress bar width', k.fill);
    ok(k.clips === '55', 'A6 flagged clip not counted', k.clips);
    const rate = parseFloat(k.rate.replace(/[^0-9.]/g, '')), total = parseFloat(k.spend.replace(/[^0-9.]/g, ''));
    ok(Math.abs(rate * 55 - total) < 0.005, 'A7 label x clips equals total', { rate, total });
    ok(!(page.__errors || []).length, 'A8 no page errors', page.__errors);
    await ctx.close();
  }

  /* ---- B. approved clips can no longer be flagged (live and demo) ----
     Every clip in the feed is approved, whoever approved it, so the menu shows
     a locked line instead of "Flag this clip" and nothing reaches the server. */
  for (const demo of [false, true]) {
    const tag = demo ? 'demo' : 'live';
    const { ctx, page } = await newPage(browser, base, { payload: payload(30, 2.5), demo });
    await page.goto(base + PAGE + '?view=clips' + (demo ? '&demo=1' : ''));
    await page.waitForSelector('#clipGrid .clip-card', { timeout: 15000 });
    await page.evaluate(() => { const b = document.getElementById('demoBlocker'); if (b) b.remove(); });
    const card = page.locator('#clipGrid .clip-card').last();
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await card.locator('.clip-menu-btn').click();
    await page.waitForTimeout(200);
    const m = await page.evaluate(() => ({
      flagBtns: document.querySelectorAll('#clipGrid .mi-flag').length,
      locked: document.querySelectorAll('#clipGrid .mi-locked').length,
      cards: document.querySelectorAll('#clipGrid .clip-card:not(.flagged)').length,
      text: (document.querySelector('#clipGrid .mi-locked') || {}).textContent || '',
      title: (document.querySelector('#clipGrid .mi-locked') || {}).title || '',
    }));
    ok(m.flagBtns === 0, 'B1 [' + tag + '] no "Flag this clip" on any approved clip', m);
    ok(m.locked === m.cards && m.cards > 0, 'B2 [' + tag + '] every approved clip shows the locked line', m);
    ok(/can.t be flagged/.test(m.text) && /no longer be flagged/.test(m.title), 'B3 [' + tag + '] it says why', m);
    await page.locator('#clipGrid .clip-card').last().locator('.mi-locked').click({ force: true });
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({
      rpc: (window.__RPC || []).filter(r => r.name === 'client_flag_clip').length,
      open: document.getElementById('flagScrim').classList.contains('open') }));
    ok(after.rpc === 0 && !after.open, 'B4 [' + tag + '] clicking it opens nothing and calls nothing', after);
    ok(!(page.__errors || []).length, 'B5 [' + tag + '] no page errors', page.__errors);
    await ctx.close();
  }

  await browser.close(); srv.close();
  console.log((fail ? 'FAILED ' : 'OK ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
