/* Clipper (creator) dashboard: Default = each campaign in its own currency,
 * the changer converts everything.
 *
 * Run:  PORTAL_DIR=/path/to/clipency-client-portal node tests/clipper-currency.browser.test.js
 *
 * Creator on two per-video campaigns: Vingo ($2.50 per video, $1,250 budget,
 * $137.50 used) and Rupee Push (Rs 250 per video, Rs 25,000 budget, Rs 1,000
 * used, fx 95.82). Two approved clips on each. Plus a per-view EUR campaign
 * with no clips, so the RPM row is covered: creators never see a per-video
 * rate (RPV), a per-view rate stays visible.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW_MODULE || 'playwright');
const DIR = process.env.PORTAL_DIR;
if (!DIR) { console.error('set PORTAL_DIR'); process.exit(2); }

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) pass++; else { fail++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(DIR, u);
      if (!f.startsWith(DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'content-type': /\.html$/.test(f) ? 'text/html' : 'application/javascript' });
      fs.createReadStream(f).pipe(rsp);
    }).listen(0, () => res(srv));
  });
}

const USD_ID = 'e18bb5d9-5ec8-416b-97a3-558275e3fd61';
const INR_ID = '11111111-2222-4333-8444-555555555555';
const EUR_ID = '99999999-2222-4333-8444-555555555555';
const ME = 'user-1';
const TABLES = {
  profiles: [{ id: ME, email: 'c@x.com', display_name: 'Creator', preferred_currency: null, created_at: '2026-06-01' }],
  campaigns: [
    { id: INR_ID, title: 'Rupee Push', status: 'active', payout_model: 'per_video', currency: 'INR',
      fx_rate_per_usd: 95.82, rate_per_video: 250, rpm: 0, budget: 25000, budget_used: 1000,
      platform_fee_percent: 0, platform_fee_amount: null, creators_count: 3, category: 'UGC',
      platform: 'Instagram', created_at: '2026-09-15', total_views: 12500 },
    { id: USD_ID, title: 'Vingo', status: 'active', payout_model: 'per_video', currency: 'USD',
      fx_rate_per_usd: 1, rate_per_video: 2.5, rpm: 0, budget: 1250, budget_used: 137.5,
      platform_fee_percent: 0, platform_fee_amount: null, creators_count: 9, category: 'UGC',
      platform: 'Instagram,YouTube', created_at: '2026-09-09', total_views: 376378 },
    { id: EUR_ID, title: 'Euro Views', status: 'active', payout_model: 'per_view', currency: 'EUR',
      fx_rate_per_usd: 0.87032, rate_per_video: 0, rpm: 500, budget: 2000, budget_used: 0,
      platform_fee_percent: 0, platform_fee_amount: null, creators_count: 2, category: 'Clipping',
      platform: 'YouTube', created_at: '2026-09-01', total_views: 4000 }
  ],
  clip_submissions: [
    { id: 's1', user_id: ME, campaign_id: USD_ID, campaign_title: 'Vingo', platform: 'Instagram', handle: '@me', status: 'approved', approved_amount: 2.5, earning_amount_native: 2.5, views_count: 1000, created_at: '2026-09-18T10:00:00Z', clip_url: 'https://x/1' },
    { id: 's2', user_id: ME, campaign_id: USD_ID, campaign_title: 'Vingo', platform: 'Instagram', handle: '@me', status: 'approved', approved_amount: 2.5, earning_amount_native: 2.5, views_count: 1000, created_at: '2026-09-19T10:00:00Z', clip_url: 'https://x/2' },
    { id: 's3', user_id: ME, campaign_id: INR_ID, campaign_title: 'Rupee Push', platform: 'Instagram', handle: '@me', status: 'approved', approved_amount: 2.61, earning_amount_native: 250, views_count: 1000, created_at: '2026-09-20T10:00:00Z', clip_url: 'https://x/3' },
    { id: 's4', user_id: ME, campaign_id: INR_ID, campaign_title: 'Rupee Push', platform: 'Instagram', handle: '@me', status: 'approved', approved_amount: 2.61, earning_amount_native: 250, views_count: 1000, created_at: '2026-09-21T10:00:00Z', clip_url: 'https://x/4' },
    { id: 's5', user_id: ME, campaign_id: EUR_ID, campaign_title: 'Euro Views', platform: 'YouTube', handle: '@me', status: 'pending', approved_amount: 0, earning_amount_native: 0, views_count: 300, created_at: '2026-09-22T10:00:00Z', clip_url: 'https://x/5' }
  ],
  connected_accounts: [], user_payment_methods: [], payout_requests: [], campaign_applications: [],
  clip_metrics_history: [], campaign_leaderboard_public: [],
  v_cx_creator_campaign_earnings: [
    { campaign_id: USD_ID, currency: 'USD', settled_native: 5, settled_usd: 5, locked: false, locked_usd: 0, locked_native: 0 },
    { campaign_id: INR_ID, currency: 'INR', settled_native: 500, settled_usd: 5.22, locked: false, locked_usd: 0, locked_native: 0 }
  ]
};

function stub(tables) {
  return `
(function(){
  var T = ${JSON.stringify(tables)};
  window.__WRITES = [];
  function q(table){
    var f = [], op = 'select', single = false;
    var b = {
      select: function(){ return b; }, order: function(){ return b; }, limit: function(){ return b; },
      gte: function(){ return b; }, lte: function(){ return b; }, neq: function(){ return b; },
      in: function(k, v){ f.push(function(r){ return v.indexOf(r[k]) > -1; }); return b; },
      eq: function(k, v){ f.push(function(r){ return String(r[k]) === String(v); }); return b; },
      update: function(v){ op = 'update'; window.__WRITES.push({table: table, update: v}); return b; },
      insert: function(v){ op = 'insert'; window.__WRITES.push({table: table, insert: v}); return b; },
      maybeSingle: function(){ single = true; return b; }, single: function(){ single = true; return b; },
      then: function(res, rej){
        var rows = (T[table] || []).filter(function(r){ return f.every(function(fn){ return fn(r); }); });
        var out = op !== 'select' ? {data: null, error: null}
          : {data: single ? (rows[0] || null) : rows, error: null};
        return Promise.resolve(out).then(res, rej);
      }
    };
    return b;
  }
  window.supabase = { createClient: function(){ return {
    auth: { getSession: async function(){ return {data:{session:{user:{id:'${ME}', email:'c@x.com'}}}}; },
            getUser: async function(){ return {data:{user:{id:'${ME}', email:'c@x.com'}}}; },
            onAuthStateChange: function(){ return {data:{subscription:{unsubscribe:function(){}}}}; },
            signOut: async function(){ return {}; } },
    from: q,
    rpc: async function(name){
      if (name === 'cx_private_campaign_teasers') return {data:[{id:'priv-1', title:'Secret Brand', is_private:true, locked:true,
        payout_model:'per_video', rate_label:'Rate per Video', currency:'USD', fx_rate_per_usd:1, budget:5000, budget_used:100,
        platform_fee:0, creator_pool:5000, creators_count:4, total_views:88000, my_application:null}], error:null};
      if (name === 'cx_campaign_creator_rates') return arguments[1] && arguments[1].p_campaign === '${USD_ID}'
        ? {data:[{platform:'youtube', payout_model:'per_video', rate:0}], error:null} : {data:[], error:null};
      if (name === 'cx_fx_rates_public') return {data:{rates:{USD:1,INR:95.82,EUR:0.87032,GBP:0.74656,AUD:1.401,CAD:1.4004,JPY:157.27},as_of:'2026-09-21'},error:null};
      return {data: [], error: null};
    },
    storage: { from: function(){ return {}; } },
    channel: function(){ var c = {on:function(){return c;}, subscribe:function(){return c;}}; return c; },
    removeChannel: function(){}
  }; } };
})();`;
}

async function boot(browser, base, mode, tables) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (/supabase-js@2/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: stub(tables || TABLES) });
    return route.abort();
  });
  await ctx.addInitScript(m => {
    try {
      localStorage.setItem('cx-onb', '1');
      if (m) localStorage.setItem('cx-curr-v2', m);
      localStorage.setItem('cx-curr', 'INR');       // a stale v1 pick must not win
    } catch (e) {}
  }, mode || null);
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await page.goto(base + 'clipper.html');
  await page.waitForSelector('#app:not(.hide)', { timeout: 15000 });
  await page.waitForTimeout(900);
  return { ctx, page };
}
async function detailInfo(page, ccy) {
  await page.evaluate(c => openDetail(CAMPAIGNS.filter(x => x.currency === c)[0]), ccy);
  await page.waitForTimeout(300);
  return page.evaluate(() => ({ rate: dRate.textContent, budget: dBudget.textContent, lab: dRateLab.textContent,
    shown: getComputedStyle(dRate.closest('.kv')).display !== 'none', card: dRate.closest('.card').textContent }));
}
/* per-video: no RPV row, the figure is not in the page, nothing per platform */
const noRpv = d => d && !d.shown && d.rate === '-' && !/RPV|YouTube \$|Instagram \$/.test(d.card);
async function snap(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#campGrid .camp')).map(c => ({
      name: (c.querySelector('.nm') || {}).textContent,
      rate: (c.querySelector('.nums b') || {}).textContent,
      nums: Array.from(c.querySelectorAll('.nums > div')).map(d => d.textContent),
      mask: !!c.querySelector('.rate-mask'), bar: !!c.querySelector('.budget'),
      hint: (c.querySelector('.hint b, .foot b') || c.querySelector('b:last-of-type') || {}).textContent,
      text: c.textContent }));
    const rows = Array.from(document.querySelectorAll('#subMineBody tr')).map(tr =>
      ({ c: tr.children[0].textContent, amt: tr.children[6] && tr.children[6].textContent }));
    return { cards, rows, earned: document.getElementById('sEarned').textContent.trim(),
      sel: document.getElementById('currSel').value, opts: document.getElementById('currSel').options.length,
      first: document.getElementById('currSel').options[0].textContent,
      note: document.getElementById('currNote').textContent };
  });
}

(async () => {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });

  /* 1. Default */
  {
    const { ctx, page } = await boot(browser, base);
    const s = await snap(page);
    const inr = s.cards.find(c => /Rupee/.test(c.name)), usd = s.cards.find(c => /Vingo/.test(c.name));
    ok(s.sel === 'DEFAULT' && s.opts === 8 && /Default/.test(s.first), '1a Default is the default view', s);
    /* Campaign cards show reach only: creators and total views, no rate, no budget. */
    ok(inr && JSON.stringify(inr.nums) === JSON.stringify(['Creators3', 'Total views12.5K']), '1b INR card: creators + views', inr && inr.nums);
    ok(usd && JSON.stringify(usd.nums) === JSON.stringify(['Creators9', 'Total views376.4K']), '1c USD card: creators + views', usd && usd.nums);
    ok(s.cards.every(c => !/[₹$]/.test(c.text) && !c.bar && !/RPV|RPM|Rate \//.test(c.text)), '1d no rate or budget on any card', s.cards.map(c => c.text));
    const pv = s.cards.find(c => /Secret Brand/.test(c.name));
    ok(pv && JSON.stringify(pv.nums) === JSON.stringify(['Creators4', 'Total views88.0K']) && !pv.mask && !/[₹$]/.test(pv.text),
       '1e private campaign card: same two figures, no rate mask, no budget', pv);
    ok(s.rows.filter(r => /Rupee/.test(r.c)).every(r => r.amt === '₹250'), '1f INR clips earned in rupees', s.rows);
    ok(s.rows.filter(r => /Vingo/.test(r.c)).every(r => r.amt === '$2.50'), '1g USD clips earned in dollars', s.rows);
    ok(s.earned === '$10.22', '1h total earned in USD when campaigns differ', s.earned);
    ok(/own currency/.test(s.note), '1i note explains Default', s.note);
    // detail page for the INR campaign
    await page.evaluate(() => openDetail(CAMPAIGNS.filter(c => c.currency === 'INR')[0]));
    await page.waitForTimeout(400);
    const d = await page.evaluate(() => ({ rate: dRate.textContent, budget: dBudget.textContent,
      lab: dBudLab.textContent, under: document.querySelector('#dProg + .prog-meta').textContent,
      k2: dK2.textContent, shown: getComputedStyle(dRate.closest('.kv')).display !== 'none',
      card: dRate.closest('.card').textContent }));
    ok(d.budget === '₹25,000', '1j detail budget in rupees', d);
    ok(d.lab === '₹1,000 / ₹25,000', '1k detail used / budget', d);
    ok(noRpv(d) && !/₹250\b/.test(d.card) && !/RPV|RPM|₹/.test(d.under), '1l per-video: no RPV row in the card, nothing about the rate under the budget bar', d);
    ok(d.k2 === '₹500', '1m your earnings on this campaign in rupees', d);
    await page.evaluate(() => openDetail(CAMPAIGNS.filter(c => c.currency === 'USD')[0]));
    await page.waitForTimeout(400);
    await page.waitForTimeout(300);   // the per-platform call would have answered by now
    const d2 = await detailInfo(page, 'USD');
    ok(noRpv(d2) && !/YouTube/.test(d2.lab), '1o per-video with per-platform rates: no breakdown either', d2);
    const pv1 = await detailInfo(page, 'EUR');
    ok(pv1.shown && pv1.lab === 'RPM rate' && /500/.test(pv1.rate), '1p per-view campaign keeps its RPM row', pv1);
    const hint = await page.evaluate(() => Array.from(document.querySelectorAll('#campGrid .camp'))
      .map(c => ({ n: c.querySelector('.nm').textContent, h: c.querySelector('.hmore').textContent })));
    ok(hint.filter(x => /Vingo|Rupee/.test(x.n)).every(x => /Brief inside/.test(x.h) && !/Rates/.test(x.h)) &&
       hint.filter(x => /Euro/.test(x.n)).every(x => /Rates and brief inside/.test(x.h)), '1q card hint promises no rate on per-video campaigns', hint);
    /* Clipper Stats focused on one campaign: per-video shows no Rate line, per-view does */
    const focus = async id => { await page.evaluate(i => setSF({ camp: i }), id); await page.waitForTimeout(300);
      return page.evaluate(() => document.getElementById('topCamps').textContent); };
    const fv = await focus(INR_ID), fe = await focus(EUR_ID);
    ok(!/Rate|₹250|per approved video/.test(fv) && /Platforms/.test(fv), '1r stats focus on a per-video campaign: no Rate line', fv);
    ok(/Rate · .*500.* per 1M views/.test(fe), '1s stats focus on a per-view campaign keeps its rate', fe);
    ok(!page.__errors.length, '1n no page errors', page.__errors);
    await ctx.close();
  }

  /* 2. USD */
  {
    const { ctx, page } = await boot(browser, base, 'USD');
    const s = await snap(page);
    const inr = await detailInfo(page, 'INR'), usd = await detailInfo(page, 'USD');
    ok(inr.budget === '$260.91' && noRpv(inr), '2a INR budget converted at campaign fx: 25000/95.82; still no RPV', inr);
    ok(usd.budget === '$1,250' && noRpv(usd), '2b USD untouched; still no RPV', usd);
    ok(s.rows.filter(r => /Rupee/.test(r.c)).every(r => r.amt === '$2.61'), '2c INR clips = stamped USD', s.rows);
    ok(s.earned === '$10.22', '2d total', s.earned);
    ok(!page.__errors.length, '2e no page errors', page.__errors);
    await ctx.close();
  }

  /* 3. INR */
  {
    const { ctx, page } = await boot(browser, base, 'INR');
    const s = await snap(page);
    const inr = await detailInfo(page, 'INR'), usd = await detailInfo(page, 'USD');
    ok(inr.budget === '₹25,000' && noRpv(inr), '3a INR exact; no RPV', inr);
    ok(/^₹1,19,7\d\d|^₹119,7\d\d/.test(usd.budget) && noRpv(usd), '3b USD budget in rupees (~1250 x 95.8); no RPV', usd);
    ok(s.rows.filter(r => /Rupee/.test(r.c)).every(r => r.amt === '₹250'), '3c INR clips exact stamp', s.rows);
    ok(/^₹9\d\d/.test(s.earned), '3d total in rupees', s.earned);
    ok(!page.__errors.length, '3e no page errors', page.__errors);
    await ctx.close();
  }

  /* 4. Picking in the changer repaints in place and persists */
  {
    const { ctx, page } = await boot(browser, base);
    await page.selectOption('#currSel', 'USD');
    await page.waitForTimeout(400);
    const inr = await detailInfo(page, 'INR');
    const st = await page.evaluate(() => ({ v2: localStorage.getItem('cx-curr-v2'), w: window.__WRITES }));
    ok(inr.budget === '$260.91' && noRpv(inr), '4a repainted in place, RPV row stays hidden', inr);
    ok(st.v2 === 'USD', '4b saved on this device', st);
    ok(st.w.some(w => w.table === 'profiles' && w.update && w.update.preferred_currency === 'USD'), '4c saved to profile', st.w);
    await page.selectOption('#currSel', 'DEFAULT');
    await page.waitForTimeout(400);
    const st2 = await page.evaluate(() => window.__WRITES.slice(-1)[0]);
    const back = await detailInfo(page, 'INR');
    ok(back.budget === '₹25,000' && noRpv(back), '4d back to Default', back);
    ok(st2 && st2.update && st2.update.preferred_currency === 'DEFAULT', '4e DEFAULT saved to profile', st2);
    await ctx.close();
  }

  /* 5. INR-only creator in Default: totals in rupees */
  {
    const t = JSON.parse(JSON.stringify(TABLES));
    t.campaigns = t.campaigns.filter(c => c.currency === 'INR');
    t.clip_submissions = t.clip_submissions.filter(s => s.campaign_id === INR_ID);
    t.v_cx_creator_campaign_earnings = t.v_cx_creator_campaign_earnings.filter(e => e.currency === 'INR');
    const { ctx, page } = await boot(browser, base, null, t);
    const s = await snap(page);
    ok(s.earned === '₹500', '5a single-currency creator: total in that currency (stamped, exact)', s.earned);
    ok(!page.__errors.length, '5b no page errors', page.__errors);
    await ctx.close();
  }

  await browser.close(); srv.close();
  console.log((fail ? 'FAILED ' : 'OK ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
