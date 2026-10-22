/* Admin console: rate per platform, $0 campaigns, client email switch.
 *
 * Run:  CONSOLE_DIR=/path/to/repo-root node tests/console-platform-rates.browser.test.js
 *
 *   P1 list shows each platform's own rate under the campaign rate
 *   P2 edit form loads the platform rows (ticked, values) and the email switch
 *   P3 saving untouched writes the same platform rows and keeps client_emails
 *   P4 a new campaign with 0 budget and 0 rate saves, with a YouTube row at 0
 *   P5 a platform brand price below its creator rate is refused, nothing written
 *   P6 unticking a platform drops it (it goes back to the campaign rate)
 *   P7 if platform rates cannot be loaded the page stops instead of risking a wipe
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
      max_videos_per_creator: 40, max_pay_per_creator: 80, community_id: null, client_emails: true,
      created_at: '2026-09-09', client_user_id: null }
  ],
  campaign_applications: [], admin_users: [{ email: 'a@x.com' }], clip_submissions: [], payout_requests: [],
  profiles: [], client_wallet_ledger: []
};
/* As in production since 018: the row carries 0, the brand rate lives in
   campaign_secrets and comes back through admin_campaign_secrets(). */
/* Vingo-style mixed campaign: YouTube pays creators 0, Instagram its own rate. */
const PRATES = [{ campaign_id: USD_ID, platform: 'instagram', rate_per_video: 2, rpm: 0, client_rate_per_video: 2.5, client_rpm: 0 },
                { campaign_id: USD_ID, platform: 'youtube', rate_per_video: 0, rpm: 0, client_rate_per_video: 0, client_rpm: 0 }];
const SECRETS = [{ campaign_id: USD_ID, client_rate_per_video: 2.5, client_rpm: 0, client_pin: '4821' },
                 { campaign_id: INR_ID, client_rate_per_video: 0, client_rpm: 0, client_pin: '1177' }];
function stub(t, secErr, prErr) {
  return `
(function(){
  var T = ${JSON.stringify(t)};
  var PRATES = ${JSON.stringify(PRATES)};
  var PR_ERR = ${JSON.stringify(prErr || null)};
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
      if (name === 'admin_platform_rates') return PR_ERR ? {data:null, error:{message:PR_ERR}} : {data:PRATES, error:null};
      if (name === 'admin_set_platform_rates') { window.__WRITES.push({rpc: name, args: arguments[1]}); return {data:[], error:null}; }
      if (name === 'admin_convert_campaign_currency') { window.__WRITES.push({rpc: name, args: arguments[1]}); return {data:{converted:true}, error:null}; }
      return {data: [], error: null};
    },
    storage: { from: function(){ return {}; } },
    channel: function(){ var c = {on:function(){return c;}, subscribe:function(){return c;}}; return c; },
    removeChannel: function(){}
  }; } };
})();`;
}
async function boot(browser, base, secErr, prErr) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (/supabase-js@2/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: stub(TABLES, secErr, prErr) });
    return route.abort();
  });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  page.on('dialog', d => d.dismiss());
  await page.goto(base + 'console.html#campaigns');
  if (!secErr && !prErr) await page.waitForSelector('#cpNew', { timeout: 15000 });
  else await page.waitForTimeout(2500);
  return { ctx, page };
}

(async () => {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  let { ctx, page } = await boot(browser, base);

  const rows = await page.$$eval('table tbody tr', trs => trs.map(tr => tr.textContent));
  const usd = rows.find(r => /Vingo/.test(r)), inr = rows.find(r => /Rupee Push/.test(r));
  ok(usd && /Instagram \$2\.00 · YouTube \$0\.00/.test(usd), 'P1a platform rates listed under Vingo', usd);
  ok(inr && !/YouTube/.test(inr), 'P1b no platform line on a campaign without rows', inr);

  await page.click(`[data-cp="${USD_ID}"]`);
  await page.waitForSelector('#cf-prates');
  const f = await page.evaluate(() => {
    const r = p => document.querySelector('.cf-pr[data-p="' + p + '"]');
    const v = p => ({ on: r(p).querySelector('.cf-pr-on').checked, cr: r(p).querySelector('.cf-pr-cr').value,
                      br: r(p).querySelector('.cf-pr-br').value, dis: r(p).querySelector('.cf-pr-cr').disabled });
    return { ig: v('instagram'), yt: v('youtube'), tt: v('tiktok'), em: document.getElementById('cf-cemails').checked,
             hint: document.getElementById('cf-prhint').textContent };
  });
  ok(f.ig.on && f.ig.cr === '2' && f.ig.br === '2.5', 'P2a Instagram row loaded', f.ig);
  ok(f.yt.on && f.yt.cr === '0' && f.yt.br === '', 'P2b YouTube row at 0 loaded', f.yt);
  ok(!f.tt.on && f.tt.dis, 'P2c TikTok unticked and disabled', f.tt);
  ok(f.em === true, 'P2d client email switch loaded on', f);
  const heads = await page.evaluate(() => document.querySelector('#cf-prates > div').textContent);
  const ph = await page.evaluate(() => [document.querySelector('.cf-pr-cr').placeholder, document.querySelector('.cf-pr-br').placeholder]);
  ok(heads === 'PlatformCreator earns per videoBrand pays per video' && ph[0] === '0' && ph[1] === 'Same', 'P2f columns are labelled', { heads, ph });
  ok(/Creator earns/.test(f.hint) && /Brand pays/.test(f.hint) && /0 in both/.test(f.hint), 'P2e hint explains both boxes and 0', f.hint);

  await page.click('#cfSave');
  await page.waitForTimeout(600);
  let w = await page.evaluate(() => window.__WRITES);
  let upd = w.find(x => x.table === 'campaigns' && x.update);
  let pr = w.find(x => x.rpc === 'admin_set_platform_rates');
  ok(upd && upd.update.client_emails === true, 'P3a client_emails kept', upd && upd.update.client_emails);
  ok(pr && pr.args.p_campaign === USD_ID && JSON.stringify(pr.args.p_rates) === JSON.stringify([
      { platform: 'instagram', rate_per_video: 2, client_rate_per_video: 2.5, rpm: 0, client_rpm: 0 },
      { platform: 'youtube', rate_per_video: 0, client_rate_per_video: 0, rpm: 0, client_rpm: 0 }]),
     'P3b same platform rows written back', pr);
  ok(!page.__errors.length, 'P3c no page errors', page.__errors);
  await ctx.close();

  // P4 new $0 campaign
  ({ ctx, page } = await boot(browser, base));
  await page.click('#cpNew');
  await page.waitForSelector('#cf-title');
  await page.fill('#cf-title', 'YouTube only');
  await page.click('#cf-model button[data-m="per_video"]');
  await page.fill('#cf-rpv', '0');
  await page.fill('#cf-budget', '0');
  await page.check('.cf-pr[data-p="youtube"] .cf-pr-on');
  await page.click('#cfSave');
  await page.waitForTimeout(600);
  w = await page.evaluate(() => window.__WRITES);
  const ins = w.find(x => x.table === 'campaigns' && x.insert);
  pr = w.find(x => x.rpc === 'admin_set_platform_rates');
  const msg = await page.evaluate(() => (document.getElementById('cfMsg') || {}).textContent || '');
  ok(ins && ins.insert.budget === 0 && ins.insert.rate_per_video === 0 && ins.insert.client_emails === false,
     'P4a $0 campaign inserted, emails off by default', { ins: ins && ins.insert, msg });
  ok(pr && pr.args.p_campaign === 'new-id' && pr.args.p_rates.length === 1 && pr.args.p_rates[0].platform === 'youtube' &&
     pr.args.p_rates[0].rate_per_video === 0, 'P4b YouTube row saved at 0 for the new campaign', pr);
  await ctx.close();

  // P5 brand below creator
  ({ ctx, page } = await boot(browser, base));
  await page.click(`[data-cp="${USD_ID}"]`);
  await page.waitForSelector('#cf-prates');
  await page.fill('.cf-pr[data-p="instagram"] .cf-pr-br', '1');
  await page.click('#cfSave');
  await page.waitForTimeout(400);
  w = await page.evaluate(() => window.__WRITES);
  const m5 = await page.evaluate(() => document.getElementById('cfMsg').textContent);
  ok(/Instagram brand price is below its creator rate/.test(m5) && w.length === 0, 'P5 refused before any write', { m5, w });

  // P6 untick YouTube
  await page.fill('.cf-pr[data-p="instagram"] .cf-pr-br', '2.5');
  await page.uncheck('.cf-pr[data-p="youtube"] .cf-pr-on');
  await page.click('#cfSave');
  await page.waitForTimeout(600);
  w = await page.evaluate(() => window.__WRITES);
  pr = w.find(x => x.rpc === 'admin_set_platform_rates');
  ok(pr && pr.args.p_rates.length === 1 && pr.args.p_rates[0].platform === 'instagram', 'P6 unticked YouTube dropped', pr);
  await ctx.close();

  // P7 load failure
  ({ ctx, page } = await boot(browser, base, null, 'boom'));
  const p7 = await page.evaluate(() => ({ newBtn: !!document.getElementById('cpNew'), text: document.body.innerText }));
  ok(!p7.newBtn && /Could not load platform rates/.test(p7.text), 'P7 stops when platform rates fail to load', p7.newBtn);
  await ctx.close();

  await browser.close(); srv.close();
  console.log((fail ? 'FAILED ' : 'OK ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
