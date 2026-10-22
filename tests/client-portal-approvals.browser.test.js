/* Client portal: the Review section (client approves or rejects new
 * submissions; silence for the review window approves them automatically).
 *
 * Run:  PORTAL_DIR=/path/to/clipency-client-portal node tests/client-portal-approvals.browser.test.js
 *
 * Vingo, per video. Live: @alpha x2 (Clipency approved) + @alpha x1 auto-approved.
 * Rejected by the client: one @beta clip. Pending: @gamma x2, @alpha x1, one of
 * them on hold (campaign paused flag).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW_MODULE || 'playwright');
const DIR = process.env.PORTAL_DIR;
if (!DIR) { console.error('set PORTAL_DIR'); process.exit(2); }

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) pass++; else { fail++; console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x)); } };
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(DIR, u);
      if (!f.startsWith(DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'content-type': /\.html$/.test(f) ? 'text/html' : /\.css$/.test(f) ? 'text/css' : 'application/javascript' });
      fs.createReadStream(f).pipe(rsp);
    }).listen(0, () => res(srv));
  });
}
const CAMP = 'e18bb5d9-5ec8-416b-97a3-558275e3fd61';
let n = 0;
const uid = () => '00000000-0000-4000-8000-' + String(++n).padStart(12, '0');
function clip(handle, status, review) {
  const id = uid();
  return { id, campaign_id: CAMP, campaign_title: 'Vingo', platform: 'Instagram', handle,
    clip_url: 'https://www.instagram.com/reel/C' + n + '/', views: 1000 * n, likes: 5, comments: 1,
    status, currency: 'INR', fx_rate_per_usd: 95.82, earned: 2.61, earned_native: 250,
    created_at: '2026-09-2' + (n % 8) + 'T10:00:00Z', flag: null, review: review || null };
}
const H = 3600000;
function pend(handle, dueInHours, paused) {
  const id = uid();
  return { id, campaign_id: CAMP, campaign_title: 'Vingo', platform: 'Instagram', handle,
    clip_url: 'https://www.instagram.com/reel/P' + n + '/', created_at: new Date(Date.now() - 5 * H).toISOString(),
    review_due_at: new Date(Date.now() + dueInHours * H).toISOString(), auto_approve_paused: !!paused };
}
const SUBS = [
  clip('@alpha', 'approved'), clip('@alpha', 'approved'),
  clip('@alpha', 'approved', { source: 'auto', at: '2026-09-27T00:00:00Z', by_me: false, reason: null }),
  clip('@beta', 'rejected', { source: 'client', at: '2026-09-27T09:00:00Z', by_me: true, reason: 'Wrong product or link' })
];
const PEND = [pend('@gamma', 30), pend('@alpha', 3), pend('@gamma', 44, true)];
const CAMPAIGN = { id: CAMP, title: 'Vingo', status: 'active', payout_model: 'per_video', currency: 'INR', fx_rate_per_usd: 95.82,
  rate_per_video: 2.61, rate_per_video_native: 250, rpm: 0, rpm_native: 0, budget: 1044, budget_native: 100000,
  created_at: '2026-09-09T00:00:00Z', start_date: '2026-09-09', platform: 'Instagram', client_review: true, client_review_hours: 48 };
const payload = (subs, pending) => ({ campaigns: [CAMPAIGN], submissions: subs, pending: pending,
  wallet: { currency: 'USD', balance: 0, ledger: [] }, fx: { rates: { USD: 1, INR: 95.82 }, as_of: '2026-09-27' }, totals: {} });

const STUB = `
window.supabase = { createClient: function(){ return {
  auth: { getUser: async function(){ return {data:{user:{id:'client-1',email:'client@example.com'}}}; },
          getSession: async function(){ return {data:{session:{user:{id:'client-1'}}}}; },
          signOut: async function(){ return {}; },
          onAuthStateChange: function(){ return {data:{subscription:{unsubscribe:function(){}}}}; } },
  rpc: async function(name, args){
    (window.__RPC = window.__RPC || []).push({name:name, args:args});
    if (name === 'client_dashboard_data') return {data: window.__PAYLOAD, error: null};
    if (name === 'client_review_clip') {
      var m = window.__MODE;
      if (m === 'settled') return {data:null, error:{message:'this clip was already approved'}};
      if (m === 'error') return {data:null, error:{message:'this campaign is not on your dashboard'}};
      return {data:{status: args.p_approve ? 'approved' : 'rejected', source:'client'}, error:null};
    }
    if (name === 'client_flag_clip') return {data:{flag_id:'f-new', status:'flagged'}, error:null};
    return {data:null, error:null};
  },
  from: function(){ var q = {select:function(){return q;}, eq:function(){return q;}, order:function(){return q;},
    in:function(){return q;}, limit:function(){return q;}, maybeSingle:async function(){return {data:null,error:null};},
    then:function(r){ return Promise.resolve({data:[],error:null}).then(r); }}; return q; }
}; } };`;

async function open(browser, base, query, p, mode) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (/supabase-js@2/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    return route.abort();
  });
  await ctx.addInitScript(({ p, m }) => {
    try { localStorage.setItem('sb-spwtkdgpgeutrhwcjrpy-auth-token', '{"fake":1}'); localStorage.setItem('clipency-tour-seen', '1'); } catch (e) {}
    window.__PAYLOAD = p; window.__MODE = m;
  }, { p, m: mode || 'ok' });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await page.goto(base + 'campaign.html' + query);
  await page.waitForFunction(() => window.CLIPENCY_LIVE && window.CLIPENCY_LIVE.mode === 'live', null, { timeout: 15000 });
  await page.waitForTimeout(600);
  return { ctx, page };
}
const state = page => page.evaluate(() => {
  const q = s => document.querySelector(s);
  const vis = e => !!(e && e.getClientRects().length);
  const nav = Array.from(document.querySelectorAll('.snav a')).map(a => a.textContent.replace(/\s+/g, ' ').trim());
  const badge = q('.snav a[data-nav="review"] .navcount');
  return {
    view: (window.CX && CX.current) || null, nav,
    badge: badge ? badge.textContent : null, badges: document.querySelectorAll('.snav .navcount').length,
    nudge: vis(q('#ovReview')), nudgeTxt: (q('#ovReview') || {}).textContent || '',
    banner: vis(q('#aprBanner')), bannerTxt: q('#aprBanner').textContent.replace(/\s+/g, ' ').trim(),
    rows: Array.from(document.querySelectorAll('#aprList .apr-row')).filter(vis).map(r => ({ id: r.dataset.id,
      c: r.querySelector('.c').textContent, due: r.querySelector('.due').textContent,
      soon: r.querySelector('.due').classList.contains('soon'), open: (r.querySelector('.rj-side a') || {}).href || '' })),
    rowH: Math.max(0, ...Array.from(document.querySelectorAll('#aprList .apr-row')).map(r => r.getBoundingClientRect().height)),
    aprText: q('#aprList').textContent, allBtn: (q('#aprAll') || {}).textContent || null,
    opts: Array.from(document.querySelectorAll('#revCreatorSel option')).map(o => o.textContent),
    note: q('#revNote').textContent, url: location.search, hours: Array.from(document.querySelectorAll('.apr-hours')).map(e => e.textContent),
    toast: q('#toastMsg').textContent, toastBad: q('#toast').classList.contains('bad'),
    modal: q('#revScrim').classList.contains('open'), submitDisabled: q('#revSubmit').disabled,
    rpc: (window.__RPC || []).filter(x => x.name === 'client_review_clip').map(x => x.args),
    cache: sessionStorage.getItem('clipency-live-v2'),
    rej: (q('#ftRej') || {}).textContent, live: (q('#ftLive') || {}).textContent,
    rejRows: Array.from(document.querySelectorAll('#rejList .rej-row')).filter(vis).map(r => ({ pill: r.querySelector('.rs').textContent,
      why: r.querySelector('.why').textContent })),
    liveCards: Array.from(document.querySelectorAll('#clipGrid .clip-card')).filter(vis).length
  };
});

(async () => {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const P = () => payload(JSON.parse(JSON.stringify(SUBS)), JSON.parse(JSON.stringify(PEND)));

  /* 1. opening a campaign: Review in the sidebar above the Clips Feed, nudge on Overview */
  {
    const { ctx, page } = await open(browser, base, '?view=overview', P());
    let s = await state(page);
    const iR = s.nav.findIndex(t => /^Review/.test(t)), iC = s.nav.findIndex(t => /^Clips Feed/.test(t));
    ok(iR > -1 && iC === iR + 1, 'A1 Review sits right above the Clips Feed', s.nav);
    ok(s.badge === '3' && s.badges === 1, 'A2 one count badge, on Review', s);
    ok(s.nudge && /3 new clips are waiting for your review/.test(s.nudgeTxt) && /48 hours/.test(s.nudgeTxt), 'A3 Overview nudge', s.nudgeTxt);
    await page.click('#ovReview');
    await page.waitForTimeout(300);
    s = await state(page);
    ok(s.view === 'review' && /view=review/.test(s.url), 'A4 nudge opens Review', s);
    ok(s.rows.length === 3 && /@alpha/.test(s.rows[0].c) && /in 2h/.test(s.rows[0].due) && s.rows[0].soon, 'A5 soonest first, flagged as soon', s.rows);
    ok(/in 1d 0?5h|in 1d 6h/.test(s.rows[1].due) && /on hold/.test(s.rows[2].due), 'A6 countdown and paused text', s.rows.map(r => r.due));
    ok(s.rows.every(r => /instagram\.com\/reel\/P\d+\//.test(r.open)), 'A7 watch link is the submitted post', s.rows.map(r => r.open));
    ok(!/[$₹]|\bINR\b|\bUSD\b/.test(s.aprText), 'A8 no money in the queue', s.aprText);
    ok(s.rowH > 60 && s.rowH < 220, 'A8b rows are compact cards, not page-tall', s.rowH);
    ok(s.opts[0] === 'All creators (2)' && s.opts.some(o => /@gamma · 2 clips/.test(o)), 'A9 creator filter lists who is waiting', s.opts);
    ok(/Approve all 3/.test(s.allBtn) && /3 waiting/.test(s.note) && s.hours.every(h => h === '48'), 'A10 bulk button, count, window', s);
    await page.selectOption('#revCreatorSel', 'instagram|@gamma');
    await page.waitForTimeout(150);
    s = await state(page);
    ok(s.rows.length === 2 && s.rows.every(r => /@gamma/.test(r.c)) && /2 waiting · @gamma/.test(s.note), 'A11 creator filter shows only that creator', s);
    await page.click('#revCreatorClear');
    await page.waitForTimeout(150);
    const chips = await page.$$eval('#revPlat .chip', cs => cs.map(c => c.dataset.plat + '=' + c.textContent.replace(/\s+/g, ' ').trim()));
    ok(chips.length === 2 && chips[0] === 'all=All platforms 3' && chips[1] === 'instagram=Instagram 3', 'A12 platform chips only offer platforms with clips waiting, with counts', chips);
    // the Clips Feed only points at Review now
    await page.evaluate(() => CX.go('clips'));
    await page.waitForTimeout(300);
    s = await state(page);
    ok(s.banner && /3 new clips are waiting in Review/.test(s.bannerTxt), 'A13 Clips Feed banner points to Review', s.bannerTxt);
    ok(!(await page.$('#feedTabs .ft[data-tab="approvals"]')) && s.liveCards === 3, 'A14 no approvals tab in the feed; live grid is live clips only', s);
    await page.click('#aprGo');
    await page.waitForTimeout(250);
    ok((await state(page)).view === 'review', 'A15 Review now opens Review');
    ok(!page.__errors.length, 'A16 no page errors', page.__errors);
    await ctx.close();
  }

  /* 2. approve one, reject one; the rejection shows in the feed's Rejected tab */
  for (const feedFirst of [false, true]) {
    const { ctx, page } = await open(browser, base, feedFirst ? '?view=clips' : '?view=review', P());
    if (feedFirst) { await page.evaluate(() => CX.go('review')); await page.waitForTimeout(250); }
    const tag = feedFirst ? '[feed opened first] ' : '';
    let s = await state(page);
    const first = s.rows[0].id;
    await page.click('#aprList .apr-row[data-id="' + first + '"] .apr-ok');
    await page.waitForTimeout(300);
    s = await state(page);
    ok(s.rpc.length === 1 && s.rpc[0].p_submission_id === first && s.rpc[0].p_approve === true && s.rpc[0].p_reason === null, tag + 'B1 approve calls client_review_clip', s.rpc);
    ok(s.rows.length === 2 && s.badge === '2' && !s.rows.some(r => r.id === first), tag + 'B2 approved clip leaves the queue, badge follows', s);
    ok(/Approved/.test(s.toast) && !s.toastBad && s.cache === null, tag + 'B3 toast, cache dropped', s);
    const second = s.rows[0].id;
    await page.click('#aprList .apr-row[data-id="' + second + '"] .apr-rej');
    await page.waitForTimeout(250);
    s = await state(page);
    ok(s.modal && s.submitDisabled, tag + 'B4 reject dialog needs a reason', s);
    await page.click('#revReasons button:nth-child(3)');
    await page.fill('#revDesc', 'shows the old pack');
    await page.click('#revSubmit');
    await page.waitForTimeout(300);
    s = await state(page);
    const last = s.rpc[s.rpc.length - 1];
    ok(last.p_submission_id === second && last.p_approve === false && last.p_reason === 'Wrong product or link: shows the old pack', tag + 'B5 reject sends the reason', last);
    ok(!s.modal && s.rows.length === 1 && s.badge === '1' && /Rejected/.test(s.toast), tag + 'B6 out of the queue', s);
    await page.evaluate(() => CX.go('clips'));
    await page.waitForTimeout(300);
    await page.click('#feedTabs .ft[data-tab="rejected"]');
    await page.waitForTimeout(250);
    s = await state(page);
    ok(s.rej === '2' && s.rejRows.length === 2 && s.rejRows.some(r => /shows the old pack/.test(r.why) && /Rejected by you/.test(r.why)) &&
       s.liveCards === 0, tag + 'B7 Rejected tab has it, and no live clips', s);
    ok(!page.__errors.length, tag + 'B8 no page errors', page.__errors);
    await ctx.close();
  }

  /* 3. someone else decided first; a real error */
  for (const mode of ['settled', 'error']) {
    const { ctx, page } = await open(browser, base, '?view=review', P(), mode);
    let s = await state(page);
    const id = s.rows[0].id;
    await page.click('#aprList .apr-row[data-id="' + id + '"] .apr-ok');
    await page.waitForTimeout(300);
    s = await state(page);
    if (mode === 'settled') ok(s.rows.length === 2 && /already approved/.test(s.toast) && !s.toastBad, 'C1 already decided: leaves quietly', s);
    else ok(s.rows.length === 3 && s.toastBad && /not on your dashboard/.test(s.toast) &&
            (await page.$eval('#aprList .apr-row[data-id="' + id + '"] .apr-ok', b => !b.disabled && b.textContent === 'Approve')), 'C2 error keeps the clip and the button', s);
    ok(!page.__errors.length, 'C3 [' + mode + '] no page errors', page.__errors);
    await ctx.close();
  }

  /* 4. approve all, two-step */
  {
    const { ctx, page } = await open(browser, base, '?view=review', P());
    await page.click('#aprAll');
    await page.waitForTimeout(150);
    let s = await state(page);
    ok(/Confirm: approve 3/.test(s.allBtn) && s.rpc.length === 0, 'D1 first click only asks', s);
    await page.click('#aprAll');
    await page.waitForTimeout(500);
    s = await state(page);
    ok(s.rpc.length === 3 && s.rpc.every(a => a.p_approve === true) && s.rows.length === 0 && s.badge === null, 'D2 all approved', s);
    ok(/3 clips approved/.test(s.toast) && /Nothing waiting/.test(s.aprText), 'D3 toast and empty text', s);
    ok(!page.__errors.length, 'D4 no page errors', page.__errors);
    await ctx.close();
  }

  /* 5. a campaign whose first clips are all still waiting */
  {
    const { ctx, page } = await open(browser, base, '?view=overview', payload([], JSON.parse(JSON.stringify(PEND))));
    let s = await page.evaluate(() => ({ hero: !!document.querySelector('.empty-hero'), text: document.body.innerText }));
    ok(!s.hero && !/NaN/.test(s.text), 'E1 not the empty hero, no NaN on Overview', s.hero);
    for (const v of ['review', 'clips', 'analytics', 'billing', 'creators']) {
      await page.goto(base + 'campaign.html?view=' + v);
      await page.waitForTimeout(800);
      const x = await page.evaluate(() => document.body.innerText);
      ok(!/NaN|Infinity/.test(x), 'E2 ' + v + ' has no NaN', v);
    }
    const t = await state(page);
    ok(t.badge === '3', 'E3 badge on every section', t.badge);
    ok(!page.__errors.length, 'E4 no page errors', page.__errors);
    await ctx.close();
  }

  /* 6. the old link to the queue */
  {
    const { ctx, page } = await open(browser, base, '?view=clips&tab=approvals', P());
    const s = await state(page);
    ok(s.view === 'review' && s.rows.length === 3, 'F1 old ?view=clips&tab=approvals opens Review', s);
    await ctx.close();
  }

  await browser.close(); srv.close();
  console.log((fail ? 'FAILED ' : 'OK ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
