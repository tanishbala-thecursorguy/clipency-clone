/* Client portal: multi-currency display + currency changer.
 *
 * Run:  PORTAL_DIR=/path/to/clipency-client-portal node tests/client-portal-currency.browser.test.js
 *
 * Two campaigns on one client: Vingo (USD, $2.50 per video, 55 clips, $1,250
 * budget) and a rupee campaign (INR, Rs 250 per video, 4 clips, Rs 25,000
 * budget, fx 95.82). Wallet $100 (the ledger is USD).
 *
 *   A. Home, Default: each card in its own currency; totals in USD (mixed)
 *   B. Home, INR: every figure in rupees; the INR campaign stays exact
 *   C. Campaign page on the INR campaign, Default: rupees end to end
 *   D. Same page, USD: converted at the campaign's own rate
 *   E. The changer: in the top bar, Default selected by default, a pick
 *      persists across reload and re-renders
 *   F. Budget page: per-campaign rows native, totals in one currency
 *   G. Single-currency client in Default: totals use that currency, not USD
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
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(DIR, u);
      if (!f.startsWith(DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rsp);
    }).listen(0, () => res(srv));
  });
}

const USD_ID = 'e18bb5d9-5ec8-416b-97a3-558275e3fd61';
const INR_ID = '11111111-2222-4333-8444-555555555555';
const FX = 95.82;
function sub(i, camp, ccy, native, fx) {
  return { id: `${camp.slice(0, 8)}-0000-4000-8000-${String(i).padStart(12, '0')}`, campaign_id: camp,
    campaign_title: camp === USD_ID ? 'Vingo' : 'Rupee Push', platform: 'Instagram', handle: '@c' + i,
    clip_url: 'https://instagram.com/reel/' + camp.slice(0, 4) + i, views: 1000, likes: 5, comments: 1,
    status: 'approved', currency: ccy, fx_rate_per_usd: fx,
    earned_native: native, earned: Math.round(native / fx * 100) / 100,
    created_at: '2026-09-1' + (i % 9) + 'T10:00:00Z' };
}
function camp(id, title, ccy, fx, rate, budget, n, created) {
  return { id, title, status: 'active', payout_model: 'per_video', currency: ccy, fx_rate_per_usd: fx,
    is_agency: false, rate_per_video_native: rate, rate_per_video: Math.round(rate / fx * 100) / 100,
    rpm_native: 0, rpm: 0, budget_native: budget, budget: Math.round(budget / fx * 100) / 100,
    spent_native: n * rate, spent: Math.round(n * rate / fx * 100) / 100,
    remaining_native: budget - n * rate, platform_fee: 0, platform_fee_native: 0,
    creator_pool: Math.round(budget / fx * 100) / 100, creator_pool_native: budget,
    created_at: created, start_date: created.slice(0, 10), platform: 'Instagram' };
}
function payload(opts) {
  opts = opts || {};
  const camps = [], subs = [];
  if (!opts.onlyUsd) {
    camps.push(camp(INR_ID, 'Rupee Push', 'INR', FX, 250, 25000, 4, '2026-09-15T00:00:00Z'));
    for (let i = 0; i < 4; i++) subs.push(sub(i, INR_ID, 'INR', 250, FX));
  }
  camps.push(camp(USD_ID, 'Vingo', 'USD', 1, 2.5, 1250, 55, '2026-09-09T00:00:00Z'));
  for (let i = 0; i < 55; i++) subs.push(sub(i, USD_ID, 'USD', 2.5, 1));
  if (opts.onlyInr) { camps.pop(); subs.splice(4); }
  return { campaigns: camps, submissions: subs,
    wallet: { currency: 'USD', balance: 100, ledger: [] },
    fx: { rates: { USD: 1, INR: FX, EUR: 0.87032, GBP: 0.74656, AUD: 1.401, CAD: 1.4004, JPY: 157.27 }, as_of: '2026-09-21' },
    totals: {} };
}

const STUB = `
window.supabase = { createClient: function(){
  return {
    auth: { getUser: async function(){ return {data:{user:{id:'client-1',email:'client@example.com'}}}; },
            getSession: async function(){ return {data:{session:{user:{id:'client-1'}}}}; },
            signOut: async function(){ return {}; },
            onAuthStateChange: function(){ return {data:{subscription:{unsubscribe:function(){}}}}; } },
    rpc: async function(name){ if (name === 'client_dashboard_data') return {data: window.__PAYLOAD, error: null};
                               return {data:null, error:null}; },
    from: function(){ var q = {select:function(){return q;}, eq:function(){return q;}, order:function(){return q;},
      in:function(){return q;}, limit:function(){return q;}, maybeSingle:async function(){return {data:null,error:null};},
      then:function(r){ return Promise.resolve({data:[],error:null}).then(r); }}; return q; }
  };
}};`;

async function ctxFor(browser, base, p, mode) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (/supabase-js@2/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    return route.abort();
  });
  await ctx.addInitScript(({ p, mode }) => {
    try {
      localStorage.setItem('sb-spwtkdgpgeutrhwcjrpy-auth-token', '{"fake":1}');
      localStorage.setItem('clipency-tour-seen', '1');
      if (mode && !sessionStorage.getItem('__modeSet')) {
        localStorage.setItem('cx-client-curr-v1', mode); sessionStorage.setItem('__modeSet', '1');
      }
    } catch (e) {}
    window.__PAYLOAD = p;
  }, { p, mode: mode || null });
  return ctx;
}
async function open(ctx, url) {
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.CLIPENCY_LIVE && window.CLIPENCY_LIVE.mode === 'live', null, { timeout: 15000 });
  await page.waitForTimeout(2300);   // count-up animations
  return page;
}
const txt = (page, sel) => page.$eval(sel, e => e.textContent.trim());
function cards(page) {
  return page.$$eval('#camps .camp', els => els.map(e => ({
    id: e.dataset.id, name: e.querySelector('h3').textContent.trim(),
    rate: e.querySelectorAll('.cn b')[2].textContent.trim(),
    budget: e.querySelector('.camp-budget .bt b').textContent.trim(),
    used: e.querySelectorAll('.camp-budget .bt b')[1].textContent.trim() })));
}

(async () => {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });

  /* A. Home, Default */
  {
    const ctx = await ctxFor(browser, base, payload());
    const page = await open(ctx, base + 'home.html');
    const cs = await cards(page);
    const inr = cs.find(c => c.id === INR_ID), usd = cs.find(c => c.id === USD_ID);
    ok(inr && inr.rate === '₹250.00', 'A1 INR card rate in rupees', inr);
    ok(inr && inr.budget === '₹25,000.00', 'A2 INR card budget in rupees (Indian grouping)', inr);
    ok(inr && inr.used === '4.0%', 'A3 INR card % used = 1000/25000', inr);
    ok(usd && usd.rate === '$2.50' && usd.budget === '$1,250.00', 'A4 USD card stays in dollars', usd);
    ok(usd && usd.used === '11.0%', 'A5 USD card % used', usd);
    const spend = await txt(page, '#pSpend'), wal = await txt(page, '#pWallet');
    // mixed -> USD: 137.50 + 1000/95.82 = 147.936
    ok(spend === '$147.94', 'A6 portfolio spend totalled in USD when currencies differ', spend);
    ok(wal === '$100.00', 'A7 wallet in USD', wal);
    const sel = await page.$eval('#cxCurSel', s => ({ v: s.value, n: s.options.length, first: s.options[0].textContent }));
    ok(sel.v === 'DEFAULT' && sel.n === 8 && sel.first === 'Default', 'A8 changer in top bar, Default selected', sel);
    ok(!page.__errors.length, 'A9 no page errors', page.__errors);
    await ctx.close();
  }

  /* B. Home, INR */
  {
    const ctx = await ctxFor(browser, base, payload(), 'INR');
    const page = await open(ctx, base + 'home.html');
    const cs = await cards(page);
    const inr = cs.find(c => c.id === INR_ID), usd = cs.find(c => c.id === USD_ID);
    ok(inr && inr.rate === '₹250.00' && inr.budget === '₹25,000.00', 'B1 INR campaign exact (never round-tripped)', inr);
    ok(usd && usd.rate === '₹239.55', 'B2 USD rate converted: 2.50 x 95.82', usd);
    ok(usd && usd.budget === '₹1,19,775.00', 'B3 USD budget converted: 1250 x 95.82', usd);
    ok(usd && usd.used === '11.0%' && inr.used === '4.0%', 'B4 % used unchanged by conversion', cs);
    const spend = await txt(page, '#pSpend'), wal = await txt(page, '#pWallet');
    ok(spend === '₹14,175.25', 'B5 spend total: 137.5 x 95.82 + 1000', spend);
    ok(wal === '₹9,582.00', 'B6 wallet $100 in rupees', wal);
    ok(!page.__errors.length, 'B7 no page errors', page.__errors);
    await ctx.close();
  }

  /* C + D. Campaign page on the INR campaign */
  for (const mode of [null, 'USD', 'EUR']) {
    const ctx = await ctxFor(browser, base, payload(), mode);
    const home = await open(ctx, base + 'home.html');
    await home.evaluate(id => CLIPDB.setActive(id), INR_ID);
    const page = await open(ctx, base + 'campaign.html?view=overview');
    const k = {
      spend: await txt(page, '#stSpend'), foot: await txt(page, '#stBudgetFoot'),
      rate: await txt(page, '#stSpendFoot'), pct: await txt(page, '#stBudget'),
      clips: await txt(page, '#stClips'), chip: await txt(page, '.client-chip')
    };
    const tag = mode || 'Default';
    if (!mode) {
      ok(k.spend === '₹1,000.00', 'C1 spend in rupees', k);
      ok(k.foot === '₹1,000.00 of ₹25,000.00 budget', 'C2 budget foot in rupees', k);
      ok(k.rate === 'at ₹250.00 per approved video', 'C3 rate label in rupees', k);
    } else if (mode === 'USD') {
      ok(k.spend === '$10.44', 'D1 spend at the campaign rate: 1000/95.82', k);
      ok(k.foot === '$10.44 of $260.91 budget', 'D2 budget 25000/95.82', k);
      ok(k.rate === 'at $2.61 per approved video', 'D3 rate 250/95.82', k);
    } else {
      ok(k.spend === '€9.08', 'D4 EUR: 1000/95.82 x 0.87032', k);
      ok(k.rate === 'at €2.27 per approved video', 'D5 EUR rate', k);
    }
    ok(k.pct === '4.0%', 'C/D pct 4.0% in every currency [' + tag + ']', k);
    ok(k.clips === '4', 'C/D only this campaign\'s clips [' + tag + ']', k);
    const r = parseFloat(k.rate.replace(/[^0-9.]/g, '')), t = parseFloat(k.spend.replace(/[^0-9.]/g, ''));
    ok(Math.abs(r * 4 - t) < 0.03, 'C/D label x clips = total [' + tag + ']', { r, t });
    ok(!page.__errors.length, 'C/D no page errors [' + tag + ']', page.__errors);
    await ctx.close();
  }

  /* E. The changer persists and re-renders */
  {
    const ctx = await ctxFor(browser, base, payload());
    const page = await open(ctx, base + 'home.html');
    await page.selectOption('#cxCurSel', 'INR');
    await page.waitForLoadState('load');
    await page.waitForFunction(() => window.CLIPENCY_LIVE && window.CLIPENCY_LIVE.mode === 'live', null, { timeout: 15000 });
    await page.waitForTimeout(2300);
    const v = await page.$eval('#cxCurSel', s => s.value);
    const stored = await page.evaluate(() => localStorage.getItem('cx-client-curr-v1'));
    const wal = await txt(page, '#pWallet');
    ok(v === 'INR' && stored === 'INR', 'E1 pick persists across reload', { v, stored });
    ok(wal === '₹9,582.00', 'E2 page re-rendered in the new currency', wal);
    await page.selectOption('#cxCurSel', 'DEFAULT');
    await page.waitForLoadState('load');
    await page.waitForFunction(() => window.CLIPENCY_LIVE && window.CLIPENCY_LIVE.mode === 'live', null, { timeout: 15000 });
    await page.waitForTimeout(2300);
    ok(await txt(page, '#pWallet') === '$100.00', 'E3 back to Default');
    await ctx.close();
  }

  /* F. Budget page */
  {
    const ctx = await ctxFor(browser, base, payload());
    const page = await open(ctx, base + 'budget.html');
    const rows = await page.$$eval('#allocList .alloc-nums', els => els.map(e => e.textContent.trim()));
    ok(rows.some(r => r.startsWith('₹1,000.00 of ₹25,000.00')), 'F1 INR allocation row in rupees', rows);
    ok(rows.some(r => r.startsWith('$137.50 of $1,250.00')), 'F2 USD allocation row in dollars', rows);
    const res = await txt(page, '#sRes'), sp = await txt(page, '#sSpent');
    // reserved USD: 1250 + 25000/95.82 = 1510.906
    ok(res === '$1,510.91', 'F3 reserved total in USD', res);
    ok(sp === '$147.94', 'F4 spent total in USD', sp);
    const wk = await page.$$eval('#wkList .wk-amt b', els => els.map(e => e.textContent.trim()));
    ok(wk.some(w => w.startsWith('₹')) && wk.some(w => w.startsWith('$')), 'F5 weekly digest per campaign currency', wk);
    ok(!page.__errors.length, 'F6 no page errors', page.__errors);
    await ctx.close();
  }

  /* G. Single-currency (INR only) client, Default */
  {
    const ctx = await ctxFor(browser, base, payload({ onlyInr: true }));
    const page = await open(ctx, base + 'home.html');
    const spend = await txt(page, '#pSpend'), wal = await txt(page, '#pWallet');
    ok(spend === '₹1,000.00', 'G1 totals in the shared currency, not USD', spend);
    ok(wal === '₹9,582.00', 'G2 wallet restated in the shared currency', wal);
    ok(!page.__errors.length, 'G3 no page errors', page.__errors);
    await ctx.close();
  }

  await browser.close(); srv.close();
  console.log((fail ? 'FAILED ' : 'OK ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
