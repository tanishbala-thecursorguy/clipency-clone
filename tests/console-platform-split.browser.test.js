/* Admin console: one dashboard per platform (campaigns.platform_split).
 *
 * Run:  CONSOLE_DIR=/path/to/repo-root node tests/console-platform-split.browser.test.js
 *
 *   S1 a split campaign is listed once per platform, named as the client sees
 *      it, the budget on one side only; an ordinary campaign is one row
 *   S2 the editor shows the setting under its own id and saves it; an
 *      untouched save keeps it; an ordinary campaign saves null
 *   S3 the review queue's campaign filter lists each half and narrows to
 *      that campaign and platform
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
const VINGO = 'e18bb5d9-5ec8-416b-97a3-558275e3fd61';
const TABLES = {
  campaigns: [
    { id: INR_ID, title: 'Rupee Push', status: 'active', payout_model: 'per_video', currency: 'INR', fx_rate_per_usd: 95.82,
      rate_per_video: 250, rpm: 0, budget: 25000, budget_used: 1000, client_rate_per_video: 0, client_rpm: 0, platform: 'instagram',
      platform_fee_percent: 0, platform_fee_amount: null, fee_mode: 'inclusive', min_videos_per_creator: 0,
      created_at: '2026-09-15', client_user_id: null, platform_split: null },
    { id: VINGO, title: 'Vingo {UGC Campaign}', status: 'active', payout_model: 'per_video', currency: 'USD', fx_rate_per_usd: 1,
      rate_per_video: 2, rpm: 0, budget: 1250, budget_used: 137.5, client_rate_per_video: 0, client_rpm: 0, platform: 'Youtube,instagram',
      platform_fee_percent: 0, platform_fee_amount: null, fee_mode: 'on_top', min_videos_per_creator: 8,
      max_videos_per_creator: 40, max_pay_per_creator: 80, community_id: null,
      created_at: '2026-09-09', client_user_id: null, platform_split: 'instagram', unpaid_hidden_for: ['u-aniket'], unpaid_hidden_mode: 'listed' }
  ],
  profiles: [
    { id: 'u-aniket', username: 'aniket.talks_', display_name: 'Aniket', full_name: 'Aniket', email: 'an@x.com', role: 'clipper' },
    { id: 'u-ananya', username: 'ananya._yaps', display_name: 'Ananya', full_name: 'Ananya', email: 'ay@x.com', role: 'clipper' }
  ],
  clip_submissions: [
    { id: 's1', user_id: 'u1', campaign_id: VINGO, campaign_title: 'Vingo {UGC Campaign}', platform: 'instagram', handle: '@ig1', clip_url: 'https://www.instagram.com/reel/A/', status: 'pending', views_count: 10, likes: 1, comments: 0, created_at: '2026-10-01T10:00:00Z' },
    { id: 's2', user_id: 'u2', campaign_id: VINGO, campaign_title: 'Vingo {UGC Campaign}', platform: 'YouTube', handle: '@yt1', clip_url: 'https://www.youtube.com/shorts/B', status: 'pending', views_count: 20, likes: 2, comments: 0, created_at: '2026-10-02T10:00:00Z' },
    { id: 's3', user_id: 'u3', campaign_id: INR_ID, campaign_title: 'Rupee Push', platform: 'instagram', handle: '@rp1', clip_url: 'https://www.instagram.com/reel/C/', status: 'pending', views_count: 30, likes: 3, comments: 0, created_at: '2026-10-03T10:00:00Z' }
  ],
  campaign_applications: [], admin_users: [{ email: 'a@x.com' }], payout_requests: [], client_wallet_ledger: []
};
const SECRETS = [{ campaign_id: VINGO, client_rate_per_video: 2.5, client_rpm: 0, client_pin: '4821' },
                 { campaign_id: INR_ID, client_rate_per_video: 0, client_rpm: 0, client_pin: '1177' }];
function stub(t) {
  return `
(function(){
  var T = ${JSON.stringify(t)};
  var SECRETS = ${JSON.stringify(SECRETS)};
  window.__WRITES = [];
  function q(table){
    var f = [], op = 'select', single = false, cols = null;
    var b = {
      select: function(c){ if (op === 'select' && c && c !== '*') cols = String(c).split(',').map(function(x){ return x.trim(); }); return b; },
      order: function(){ return b; }, limit: function(){ return b; }, range: function(){ return b; },
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
      if (name === 'admin_campaign_secrets') return {data:SECRETS, error:null};
      if (name === 'admin_find_creators') { var q = String((arguments[1] || {}).p_q || '').toLowerCase();
        return {data: T.profiles.filter(function(p){ return (p.username + ' ' + p.display_name + ' ' + p.email).toLowerCase().indexOf(q) > -1; })
          .map(function(p){ return {id: p.id, email: p.email, role: p.role, username: p.username, name: p.display_name}; }), error: null}; }
      if (name === 'cx_fx_rates_public') return {data:{rates:{USD:1,INR:95.82,EUR:0.87032,GBP:0.74656,AUD:1.401,CAD:1.4004,JPY:157.27},as_of:'2026-09-21'}, error:null};
      return {data: [], error: null};
    },
    storage: { from: function(){ return {}; } },
    channel: function(){ var c = {on:function(){return c;}, subscribe:function(){return c;}}; return c; },
    removeChannel: function(){}
  }; } };
})();`;
}
const t = s => String(s || '').replace(/\s+/g, ' ').trim();

(async () => {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (/supabase-js@2/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: stub(TABLES) });
    return route.abort();
  });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  page.on('dialog', d => d.dismiss());
  await page.goto(base + 'console.html#campaigns');
  await page.waitForSelector('#cpNew', { timeout: 15000 });

  /* S1 the list */
  const rows = await page.$$eval('table tbody tr', trs => trs.map(tr => tr.textContent.replace(/\s+/g, ' ').trim()));
  const ig = rows.find(r => /Vingo · Instagram/.test(r)), yt = rows.find(r => /Vingo · YouTube/.test(r)), rp = rows.find(r => /Rupee Push/.test(r));
  ok(rows.length === 3 && ig && yt && rp, 'S1a three rows: a split campaign twice, an ordinary one once', rows.map(r => r.slice(0, 40)));
  ok(/Instagram dashboard/.test(ig) && /\$137\.50 \/ \$1,250\.00/.test(ig) && / Instagram /.test(ig), 'S1b the Instagram half carries the budget and names its platform', ig);
  ok(/YouTube dashboard/.test(yt) && /no separate budget/.test(yt) && /bills the Instagram budget/.test(yt) && !/\$1,250\.00/.test(yt), 'S1c the YouTube half has no budget of its own', yt);
  ok(rows.indexOf(ig) === rows.indexOf(yt) - 1 && /\$2\.50/.test(yt), 'S1d halves sit together, the budget side first, same rate', [rows.indexOf(ig), rows.indexOf(yt)]);
  ok(/₹1,000\.00 \/ ₹25,000\.00/.test(rp) && !/dashboard/.test(rp), 'S1e an ordinary campaign is unchanged', rp);
  const edits = await page.$$eval(`[data-cp="${VINGO}"]`, bs => bs.length);
  ok(edits === 2, 'S1f each half has an Edit button for the one record', edits);

  /* S2 the editor */
  await page.click(`[data-cp="${VINGO}"]`);
  await page.waitForSelector('#cf-psplit');
  const e1 = await page.evaluate(() => ({ v: document.getElementById('cf-psplit').value,
    opts: Array.from(document.querySelectorAll('#cf-psplit option')).map(o => o.textContent),
    dup: document.querySelectorAll('#cf-psplit').length, oldSplit: !!document.getElementById('cf-split') }));
  ok(e1.v === 'instagram' && e1.dup === 1, 'S2a the setting shows the budget side', e1);
  ok(e1.opts.length === 4 && /One dashboard for every platform/.test(e1.opts[0]) && /budget shows on YouTube/.test(e1.opts.join('|')), 'S2b one option per platform plus off', e1.opts);
  ok(e1.oldSplit, 'S2c the fee split preview keeps its own id (no clash)', e1.oldSplit);
  await page.click('#cfSave');
  await page.waitForTimeout(500);
  let w = await page.evaluate(() => window.__WRITES.filter(x => x.table === 'campaigns' && x.update));
  ok(w.length && w[w.length - 1].update.platform_split === 'instagram', 'S2d an untouched save keeps the setting', w[w.length - 1] && w[w.length - 1].update.platform_split);
  await page.evaluate(() => { try { closeModal(); } catch (e) {} });
  await page.waitForTimeout(200);
  await page.click(`[data-cp="${VINGO}"]`);
  await page.waitForSelector('#cf-psplit');
  await page.selectOption('#cf-psplit', 'youtube');
  await page.click('#cfSave');
  await page.waitForTimeout(500);
  w = await page.evaluate(() => window.__WRITES.filter(x => x.table === 'campaigns' && x.update));
  ok(w[w.length - 1].update.platform_split === 'youtube', 'S2e changing the budget side saves it', w[w.length - 1].update.platform_split);
  await page.evaluate(() => { try { closeModal(); } catch (e) {} });
  await page.waitForTimeout(200);
  await page.click(`[data-cp="${INR_ID}"]`);
  await page.waitForSelector('#cf-psplit');
  const e2 = await page.$eval('#cf-psplit', s => s.value);
  await page.click('#cfSave');
  await page.waitForTimeout(500);
  w = await page.evaluate(() => window.__WRITES.filter(x => x.table === 'campaigns' && x.update));
  ok(e2 === '' && w[w.length - 1].update.platform_split === null, 'S2f an ordinary campaign saves null', [e2, w[w.length - 1].update.platform_split]);
  await page.evaluate(() => { try { closeModal(); } catch (e) {} });

  /* S5 creators who still see unpaid-platform clips */
  await page.waitForTimeout(200);
  await page.click(`[data-cp="${VINGO}"]`);
  await page.waitForSelector('#cf-unpaid');
  await page.waitForTimeout(400);
  const chips = () => page.$$eval('#cf-unpaid-chips .chip', cs => cs.map(c => c.textContent.replace(/\s+/g, ' ').trim()));
  ok((await chips()).join('|') === '@aniket.talks_×', 'S5a the named creator shows as a chip by handle', await chips());
  ok(await page.$eval('#cf-unpaid-mode', s => s.value) === 'listed', 'S5a2 the rule applies to the named creators by default', null);
  await page.fill('#cf-unpaid-q', 'ana');
  await page.waitForTimeout(500);
  const hits = await page.$$eval('#cf-unpaid-hits [data-unpaid-add]', bs => bs.map(b => b.dataset.unpaidAdd + ':' + b.dataset.lab));
  ok(hits.join('|') === 'u-ananya:@ananya._yaps', 'S5b search offers matching creators not yet named', hits);
  await page.click('[data-unpaid-add="u-ananya"]');
  await page.waitForTimeout(100);
  ok((await chips()).join('|') === '@aniket.talks_×|@ananya._yaps×', 'S5c picking one adds a chip', await chips());
  await page.click('#cfSave');
  await page.waitForTimeout(500);
  w = await page.evaluate(() => window.__WRITES.filter(x => x.table === 'campaigns' && x.update));
  ok(JSON.stringify(w[w.length - 1].update.unpaid_hidden_for) === JSON.stringify(['u-aniket', 'u-ananya']) && w[w.length - 1].update.unpaid_hidden_mode === 'listed',
     'S5d saving writes the ids and the mode', [w[w.length - 1].update.unpaid_hidden_for, w[w.length - 1].update.unpaid_hidden_mode]);
  await page.evaluate(() => { try { closeModal(); } catch (e) {} });
  await page.waitForTimeout(200);
  await page.click(`[data-cp="${VINGO}"]`);
  await page.waitForSelector('#cf-unpaid');
  await page.waitForTimeout(400);
  await page.click('[data-unpaid-rm="u-aniket"]');
  await page.selectOption('#cf-unpaid-mode', 'all_but_listed');
  await page.click('#cfSave');
  await page.waitForTimeout(500);
  w = await page.evaluate(() => window.__WRITES.filter(x => x.table === 'campaigns' && x.update));
  ok(JSON.stringify(w[w.length - 1].update.unpaid_hidden_for) === JSON.stringify([]) && w[w.length - 1].update.unpaid_hidden_mode === 'all_but_listed',
     'S5e removing the chip and switching the mode saves both (the stub row carried only Aniket)', [w[w.length - 1].update.unpaid_hidden_for, w[w.length - 1].update.unpaid_hidden_mode]);
  await page.evaluate(() => { try { closeModal(); } catch (e) {} });

  /* S3 the review queue */
  await page.evaluate(() => { location.hash = '#reviews'; });
  await page.waitForSelector('#rvCamp', { timeout: 15000 });
  await page.waitForTimeout(300);
  const opts = await page.$$eval('#rvCamp option', os => os.map(o => ({ v: o.value, t: o.textContent })));
  ok(opts.map(o => o.t).join('|') === 'All campaigns|Rupee Push|Vingo · Instagram|Vingo · YouTube', 'S3a the campaign filter lists each half', opts.map(o => o.t));
  const rv = async () => page.$$eval('table tbody tr', trs => trs.map(tr => tr.textContent.replace(/\s+/g, ' ').trim()));
  let r = await rv();
  ok(r.length === 3, 'S3b every submission before filtering', r.length);
  await page.selectOption('#rvCamp', 'Vingo {UGC Campaign}|youtube');
  await page.waitForTimeout(400);
  r = await rv();
  ok(r.length === 1 && /@yt1/.test(r[0]) && /YouTube/.test(r[0]), 'S3c the YouTube half shows the YouTube submission only', r);
  await page.selectOption('#rvCamp', 'Vingo {UGC Campaign}|instagram');
  await page.waitForTimeout(400);
  r = await rv();
  ok(r.length === 1 && /@ig1/.test(r[0]), 'S3d the Instagram half shows the Instagram submission only', r);
  await page.selectOption('#rvCamp', '');
  await page.waitForTimeout(400);
  r = await rv();
  ok(r.length === 3, 'S3e back to every campaign', r.length);
  ok(!page.__errors.length, 'S4 no page errors', page.__errors);

  await ctx.close(); await browser.close(); srv.close();
  console.log((fail ? 'FAILED ' : 'OK ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
