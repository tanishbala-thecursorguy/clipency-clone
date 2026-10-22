/* Admin console: campaign currency.
 *
 * Run:  CONSOLE_DIR=/path/to/repo-root node tests/console-currency.browser.test.js
 *
 *   K1 list shows each campaign in its own currency
 *   K2 KPIs total in USD at each campaign's rate
 *   K3 editing an INR campaign: currency INR, selectable, labels in Rs
 *   K8 switching a paid campaign's currency: the dropdown works, every amount in
 *      the form converts, saving calls admin_convert_campaign_currency first
 *   K4 creating a campaign in INR sends currency INR and native amounts
 *   K5 saving an untouched edit keeps every field it loaded (the 12 Sep wipe)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW_MODULE || 'playwright');
const DIR = process.env.CONSOLE_DIR;
if (!DIR) { console.error('set CONSOLE_DIR'); process.exit(2); }

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) pass++; else { fail++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      let u = decodeURIComponent(req.url.split('?')[0]);
      if (u === '/console') u = '/console.html';
      const f = path.join(DIR, u);
      if (!f.startsWith(DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'content-type': /\.html$/.test(f) ? 'text/html' : 'application/javascript' });
      fs.createReadStream(f).pipe(rsp);
    }).listen(0, () => res(srv));
  });
}
const INR_ID = '11111111-2222-4333-8444-555555555555';
const USD_ID = 'e18bb5d9-5ec8-416b-97a3-558275e3fd61';
const TABLES = {
  campaigns: [
    { id: INR_ID, title: 'Rupee Push', status: 'active', payout_model: 'per_video', currency: 'INR', fx_rate_per_usd: 95.82,
      rate_per_video: 250, rpm: 0, budget: 25000, budget_used: 1000, client_rate_per_video: 0, client_rpm: 0,
      platform_fee_percent: 0, platform_fee_amount: null, fee_mode: 'inclusive', min_videos_per_creator: 0,
      created_at: '2026-09-15', client_user_id: null },
    { id: USD_ID, title: 'Vingo', status: 'active', payout_model: 'per_video', currency: 'USD', fx_rate_per_usd: 1,
      rate_per_video: 2, rpm: 0, budget: 1250, budget_used: 137.5, client_rate_per_video: 0, client_rpm: 0,
      platform_fee_percent: 0, platform_fee_amount: null, fee_mode: 'on_top', min_videos_per_creator: 8,
      max_videos_per_creator: 40, max_pay_per_creator: 80, community_id: null,
      created_at: '2026-09-09', client_user_id: null }
  ],
  campaign_applications: [], admin_users: [{ email: 'a@x.com' }], clip_submissions: [], payout_requests: [],
  profiles: [], client_wallet_ledger: []
};
/* As in production since 018: the row carries 0, the brand rate lives in
   campaign_secrets and comes back through admin_campaign_secrets(). */
const SECRETS = [{ campaign_id: USD_ID, client_rate_per_video: 2.5, client_rpm: 0, client_pin: '4821' },
                 { campaign_id: INR_ID, client_rate_per_video: 0, client_rpm: 0, client_pin: '1177' }];
function stub(t, secErr) {
  return `
(function(){
  var T = ${JSON.stringify(t)};
  var SECRETS = ${JSON.stringify(SECRETS)};
  var SEC_ERR = ${JSON.stringify(secErr || null)};
  window.__WRITES = [];
  function q(table){
    var f = [], op = 'select', single = false, cols = null;
    var b = {
      /* honour the column list, like PostgREST: a column the page did not
         ask for does not come back */
      select: function(c){ if (op === 'select' && c && c !== '*') cols = String(c).split(',').map(function(x){ return x.trim(); }); return b; }, order: function(){ return b; }, limit: function(){ return b; }, range: function(){ return b; },
      gte: function(){ return b; }, lte: function(){ return b; }, neq: function(){ return b; }, not: function(){ return b; },
      is: function(){ return b; }, or: function(){ return b; }, ilike: function(){ return b; },
      in: function(k, v){ f.push(function(r){ return v.indexOf(r[k]) > -1; }); return b; },
      eq: function(k, v){ if (op === 'select') f.push(function(r){ return String(r[k]) === String(v); }); return b; },
      update: function(v){ op = 'update'; window.__WRITES.push({table: table, update: v}); return b; },
      insert: function(v){ op = 'insert'; window.__WRITES.push({table: table, insert: v}); return b; },
      maybeSingle: function(){ single = true; return b; }, single: function(){ single = true; return b; },
      then: function(res, rej){
        var rows = (T[table] || []).filter(function(r){ return f.every(function(fn){ return fn(r); }); });
        if (cols) rows = rows.map(function(r){ var o = {}; cols.forEach(function(k){ if (k in r) o[k] = r[k]; }); return o; });
        var out = op === 'insert' ? {data: {id: 'new-id'}, error: null}
          : op !== 'select' ? {data: null, error: null}
          : {data: single ? (rows[0] || null) : rows, error: null, count: rows.length};
        return Promise.resolve(out).then(res, rej);
      }
    };
    return b;
  }
  window.supabase = { createClient: function(){ return {
    auth: { getUser: async function(){ return {data:{user:{id:'admin-1', email:'a@x.com', user_metadata:{full_name:'Admin'}}}}; },
            getSession: async function(){ return {data:{session:{user:{id:'admin-1'}}}}; },
            onAuthStateChange: function(){ return {data:{subscription:{unsubscribe:function(){}}}}; } },
    from: q,
    rpc: async function(name){
      if (name === 'admin_access_check') return {data:{role:'admin'}, error:null};
      if (name === 'admin_campaign_secrets') return SEC_ERR ? {data:null, error:{message:SEC_ERR}} : {data:SECRETS, error:null};
      if (name === 'cx_fx_rates_public') return {data:{rates:{USD:1,INR:95.82,EUR:0.87032,GBP:0.74656,AUD:1.401,CAD:1.4004,JPY:157.27},as_of:'2026-09-21'}, error:null};
      if (name === 'admin_convert_campaign_currency') { window.__WRITES.push({rpc: name, args: arguments[1]}); return {data:{converted:true}, error:null}; }
      return {data: [], error: null};
    },
    storage: { from: function(){ return {}; } },
    channel: function(){ var c = {on:function(){return c;}, subscribe:function(){return c;}}; return c; },
    removeChannel: function(){}
  }; } };
})();`;
}
async function boot(browser, base, secErr) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (/supabase-js@2/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: stub(TABLES, secErr) });
    return route.abort();
  });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  page.on('dialog', d => d.dismiss());
  await page.goto(base + 'console.html#campaigns');
  if (!secErr) await page.waitForSelector('#cpNew', { timeout: 15000 });
  else await page.waitForTimeout(2500);
  return { ctx, page };
}

(async () => {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const { ctx, page } = await boot(browser, base);

  const rows = await page.$$eval('table tbody tr', trs => trs.map(tr => tr.textContent));
  const inr = rows.find(r => /Rupee Push/.test(r)), usd = rows.find(r => /Vingo/.test(r));
  ok(inr && /₹250\.00/.test(inr) && /₹1,000\.00 \/ ₹25,000\.00/.test(inr), 'K1a INR row in rupees', inr);
  ok(usd && /\$2\.50/.test(usd) && /\$137\.50 \/ \$1,250\.00/.test(usd), 'K1b USD row in dollars', usd);
  const kpi = await page.$$eval('.kpi', ks => ks.map(k => k.textContent));
  ok(kpi.some(k => /Budget\$1510\.91/.test(k.replace(/\s+/g, ''))), 'K2 budget KPI in USD: 1250 + 25000/95.82', kpi);

  // K3 edit INR
  await page.click(`[data-cp="${INR_ID}"]`);
  await page.waitForSelector('#cf-ccy');
  const k3 = await page.evaluate(() => ({ v: document.getElementById('cf-ccy').value,
    dis: document.getElementById('cf-ccy').disabled,
    syms: Array.from(document.querySelectorAll('.cf-sym')).map(x => x.textContent),
    split: document.getElementById('cf-split').textContent }));
  ok(k3.v === 'INR' && !k3.dis, 'K3a INR, and the dropdown is usable even with paid clips', k3);
  ok(k3.syms.length >= 5 && k3.syms.every(x => x === '₹'), 'K3b money labels in rupees', k3.syms);
  ok(/₹25,000\.00/.test(k3.split), 'K3c split preview in rupees', k3.split);
  await page.click('#cfSave');
  await page.waitForTimeout(500);
  let w = await page.evaluate(() => window.__WRITES.filter(x => x.table === 'campaigns'));
  ok(w.length && !('currency' in w[w.length - 1].update), 'K3d unchanged currency is not re-sent', w);
  await page.evaluate(() => { try { closeModal(); } catch (e) {} });

  // K5 untouched Vingo edit keeps what it loaded
  await page.waitForTimeout(200);
  await page.click(`[data-cp="${USD_ID}"]`);
  await page.waitForSelector('#cf-ccy');
  await page.click('#cfSave');
  await page.waitForTimeout(500);
  w = await page.evaluate(() => window.__WRITES.filter(x => x.table === 'campaigns'));
  const up = w[w.length - 1].update;
  ok(up.client_rate_per_video === 2.5, 'K5a brand rate kept', up.client_rate_per_video);
  ok(up.fee_mode === 'on_top', 'K5b fee mode kept', up.fee_mode);
  ok(up.min_videos_per_creator === 8 && up.max_videos_per_creator === 40 && up.max_pay_per_creator === 80,
     'K5c per-creator min/max kept', up);
  await page.evaluate(() => { try { closeModal(); } catch (e) {} });

  // K8 convert Vingo (paid clips) from USD to INR in the form, then save
  await page.waitForTimeout(200);
  await page.click(`[data-cp="${USD_ID}"]`);
  await page.waitForSelector('#cf-ccy');
  await page.selectOption('#cf-ccy', 'INR');
  await page.waitForTimeout(300);
  const k8 = await page.evaluate(() => ({ rpv: $('#cf-rpv').value, cvid: $('#cf-cvid').value, budget: $('#cf-budget').value,
    maxpaycr: $('#cf-maxpaycr').value, hint: $('#cf-ccyhint').textContent,
    syms: Array.from(document.querySelectorAll('.cf-sym')).map(x => x.textContent) }));
  ok(k8.rpv === '191.64' && k8.cvid === '239.55' && k8.budget === '119775' && k8.maxpaycr === '7665.6',
     'K8a creator rate, brand rate, budget and cap converted at 95.82', k8);
  ok(k8.syms.every(x => x === '₹') && /95\.82 INR/.test(k8.hint) && /keep exactly/.test(k8.hint), 'K8b labels + hint explain the conversion', k8);
  // switching back restores the original numbers exactly
  await page.selectOption('#cf-ccy', 'USD');
  await page.waitForTimeout(300);
  const back = await page.evaluate(() => ({ rpv: $('#cf-rpv').value, budget: $('#cf-budget').value, cvid: $('#cf-cvid').value }));
  ok(back.rpv === '2' && back.budget === '1250' && back.cvid === '2.5', 'K8c back to USD restores the figures', back);
  await page.selectOption('#cf-ccy', 'INR');
  await page.waitForTimeout(300);
  await page.click('#cfSave');
  await page.waitForTimeout(600);
  w = await page.evaluate(() => window.__WRITES);
  const cv = w.filter(x => x.rpc === 'admin_convert_campaign_currency');
  const lastUp = w.filter(x => x.table === 'campaigns' && x.update).slice(-1)[0];
  ok(cv.length === 1 && cv[0].args.p_campaign === USD_ID && cv[0].args.p_currency === 'INR', 'K8d save converts through the server', cv);
  ok(lastUp && !('currency' in lastUp.update) && lastUp.update.rate_per_video === 191.64 && lastUp.update.budget === 119775,
     'K8e then writes the converted form values, currency left to the conversion', lastUp);
  ok(w.indexOf(cv[0]) < w.indexOf(lastUp), 'K8f conversion happens before the update', null);
  await page.evaluate(() => { try { closeModal(); } catch (e) {} });

  // K4 new campaign in INR
  await page.waitForTimeout(200);
  await page.click('#cpNew');
  await page.waitForSelector('#cf-ccy');
  ok(await page.$eval('#cf-ccy', s => s.value === 'USD' && !s.disabled), 'K4a new campaign defaults to USD, editable');
  await page.selectOption('#cf-ccy', 'INR');
  const syms = await page.$$eval('.cf-sym', xs => xs.map(x => x.textContent));
  ok(syms.every(x => x === '₹'), 'K4b labels follow the picked currency', syms);
  await page.fill('#cf-title', 'New Rupee');
  await page.click('#cf-model button[data-m="per_video"]');
  await page.fill('#cf-rpv', '250');
  await page.fill('#cf-budget', '25000');
  await page.click('#cfSave');
  await page.waitForTimeout(500);
  w = await page.evaluate(() => window.__WRITES.filter(x => x.table === 'campaigns' && x.insert));
  const ins = w.length && w[w.length - 1].insert;
  ok(ins && ins.currency === 'INR' && ins.rate_per_video === 250 && ins.budget === 25000,
     'K4c insert: INR, native Rs 250 and Rs 25,000', ins);
  ok(!page.__errors.length, 'K6 no page errors', page.__errors);
  await ctx.close();

  /* K7 the secrets call fails: no campaign form is offered, so nothing can
     be saved with a blank brand rate */
  {
    const b = await boot(browser, base, 'permission denied');
    const st = await b.page.evaluate(() => ({ edit: document.querySelectorAll('[data-cp]').length,
      body: document.body.textContent }));
    ok(st.edit === 0 && /Could not load brand rates/.test(st.body), 'K7 refuses to render the editor without brand rates', st.edit);
    await b.ctx.close();
  }
 await browser.close(); srv.close();
  console.log((fail ? 'FAILED ' : 'OK ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
