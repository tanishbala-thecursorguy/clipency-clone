/* Clipper (creator) dashboard: clips on a platform the campaign does not pay
 * for never count as approved, and are hidden entirely for the creators the
 * campaign names.
 *
 * Run:  PORTAL_DIR=/path/to/clipency-client-portal node tests/clipper-unpaid-platform.browser.test.js
 *
 * Vingo pays Instagram ($2.50 per video) and YouTube at 0. The creator has on
 * Vingo: 2 Instagram approved, 2 YouTube approved, 1 YouTube pending, 1
 * YouTube rejected; and 1 Instagram approved on Rupee Push. Other creators
 * have 3 Instagram and 2 YouTube approved on Vingo.
 *
 *   A  not named (the default): YouTube clips show, tagged 'not paid', but do
 *      not count as approved anywhere; the campaign page says so
 *   B  named, mode 'listed': YouTube left off entirely
 *   B2 named, no mode on the row: same as 'listed'
 *   C  mode 'all_but_listed', named: as A (shows, not counted)
 *   D  mode 'all_but_listed', someone else named: as B (hidden)
 *   E  named but no per-platform rates: nothing is unpaid, everything counts
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
const ME = 'user-1';
const sub = (id, camp, title, plat, status, amt, user, extra) => Object.assign({
  id, user_id: user || ME, campaign_id: camp, campaign_title: title, platform: plat, handle: user ? '@' + user : '@me', status,
  approved_amount: amt, earning_amount_native: amt, views_count: 1000, views: 1000, likes: 10, comments: 1,
  clip_url: plat === 'YouTube' ? 'https://www.youtube.com/shorts/' + id : 'https://www.instagram.com/reel/' + id + '/',
  created_at: '2026-10-0' + (1 + (id.charCodeAt(1) % 9)) + 'T10:00:00Z', metrics_status: 'ok', metrics_fetched_at: '2026-10-10T10:00:00Z'
}, extra || {});
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
      platform: 'Instagram,YouTube', created_at: '2026-09-09', total_views: 376378 }
  ],
  clip_submissions: [
    sub('m1', USD_ID, 'Vingo', 'Instagram', 'approved', 2.5), sub('m2', USD_ID, 'Vingo', 'Instagram', 'approved', 2.5),
    sub('m3', USD_ID, 'Vingo', 'YouTube', 'approved', 0), sub('m4', USD_ID, 'Vingo', 'YouTube', 'approved', 0),
    sub('m5', USD_ID, 'Vingo', 'YouTube', 'pending', 0), sub('m6', USD_ID, 'Vingo', 'YouTube', 'rejected', 0, null, { rejection_reason: 'Low quality' }),
    sub('m7', INR_ID, 'Rupee Push', 'Instagram', 'approved', 250),
    sub('o1', USD_ID, 'Vingo', 'Instagram', 'approved', 2.5, 'x1'), sub('o2', USD_ID, 'Vingo', 'Instagram', 'approved', 2.5, 'x1'), sub('o3', USD_ID, 'Vingo', 'Instagram', 'approved', 2.5, 'x1'),
    sub('o4', USD_ID, 'Vingo', 'YouTube', 'approved', 0, 'x2'), sub('o5', USD_ID, 'Vingo', 'YouTube', 'approved', 0, 'x2')
  ],
  connected_accounts: [], user_payment_methods: [], payout_requests: [], campaign_applications: [],
  clip_metrics_history: [], campaign_leaderboard_public: [],
  v_cx_creator_campaign_earnings: [
    { campaign_id: USD_ID, currency: 'USD', settled_native: 5, settled_usd: 5, locked: false, locked_usd: 0, locked_native: 0 },
    { campaign_id: INR_ID, currency: 'INR', settled_native: 250, settled_usd: 2.61, locked: false, locked_usd: 0, locked_native: 0 }
  ]
};

function stub(tables, rates) {
  return `
(function(){
  var T = ${JSON.stringify(tables)};
  var RATES = ${JSON.stringify(rates)};
  function q(table){
    var f = [], op = 'select', single = false;
    var b = {
      select: function(){ return b; }, order: function(){ return b; }, limit: function(){ return b; },
      gte: function(){ return b; }, lte: function(){ return b; }, neq: function(){ return b; },
      in: function(k, v){ f.push(function(r){ return v.indexOf(r[k]) > -1; }); return b; },
      eq: function(k, v){ f.push(function(r){ return String(r[k]) === String(v); }); return b; },
      update: function(v){ op = 'update'; return b; }, insert: function(v){ op = 'insert'; return b; },
      maybeSingle: function(){ single = true; return b; }, single: function(){ single = true; return b; },
      then: function(res, rej){
        var rows = (T[table] || []).filter(function(r){ return f.every(function(fn){ return fn(r); }); });
        var out = op !== 'select' ? {data: null, error: null} : {data: single ? (rows[0] || null) : rows, error: null};
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
    rpc: async function(name, args){
      if (name === 'cx_campaign_creator_rates') return {data: RATES[args && args.p_campaign] || [], error: null};
      if (name === 'cx_fx_rates_public') return {data:{rates:{USD:1,INR:95.82,EUR:0.87032,GBP:0.74656,AUD:1.401,CAD:1.4004,JPY:157.27},as_of:'2026-09-21'},error:null};
      return {data: [], error: null};
    },
    storage: { from: function(){ return {}; } },
    channel: function(){ var c = {on:function(){return c;}, subscribe:function(){return c;}}; return c; },
    removeChannel: function(){}
  }; } };
})();`;
}
const RATES = { [USD_ID]: [{ platform: 'instagram', payout_model: 'per_video', rate: 2.5 }, { platform: 'youtube', payout_model: 'per_video', rate: 0 }] };
/* the Vingo row with the rule set a given way */
function vingo(mode, named) {
  const T2 = JSON.parse(JSON.stringify(TABLES));
  const c = T2.campaigns.find(x => x.id === USD_ID);
  if (mode !== undefined) c.unpaid_hidden_mode = mode;
  if (named !== undefined) c.unpaid_hidden_for = named;
  return T2;
}

async function boot(browser, base, rates, tables) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (/supabase-js@2/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: stub(tables || TABLES, rates) });
    return route.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem('cx-onb', '1'); } catch (e) {} });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await page.goto(base + 'clipper.html');
  await page.waitForSelector('#app:not(.hide)', { timeout: 15000 });
  await page.waitForTimeout(900);
  return { ctx, page };
}
const snap = page => page.evaluate(() => {
  const t = s => String(s || '').replace(/\s+/g, ' ').trim();
  return {
    approved: t(document.getElementById('sApproved').textContent),
    mine: Array.from(document.querySelectorAll('#subMineBody tr')).map(tr => tr.children.length > 2 ? t(tr.children[0].textContent) + ' / ' + t(tr.children[1].textContent) + ' / ' + t(tr.children[7].textContent) : t(tr.textContent)),
    rej: Array.from(document.querySelectorAll('#subRejBody tr')).map(tr => tr.children.length > 2 ? t(tr.children[0].textContent) + ' / ' + t(tr.children[1].textContent) : t(tr.textContent)),
    plats: Array.from(document.querySelectorAll('#sfPlats button')).map(b => t(b.textContent)),
    subs: window.SUBS.length, subsAll: window.SUBS_ALL.length
  };
});
const detail = async (page, id) => {
  await page.evaluate(i => openDetail(CAMPAIGNS.filter(x => x.id === i)[0]), id);
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    const t = s => String(s || '').replace(/\s+/g, ' ').trim();
    const n = document.getElementById('dUnpaid');
    return { note: getComputedStyle(n).display !== 'none' ? t(n.textContent) : '', k2s: t(dK2s.textContent), k3: t(dK3.textContent), viewsSub: t(dViewsSub.textContent) };
  });
};
/* optional screenshots (SHOT_DIR): a view, scrolled to a selector when given */
const shot = async (page, name, view, sel) => {
  if (!process.env.SHOT_DIR) return;
  await page.evaluate(a => { go(a.view); const e = a.sel && document.querySelector(a.sel); if (e) e.scrollIntoView({ block: 'center' }); }, { view, sel });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(process.env.SHOT_DIR, 'unpaid-' + name + '.png') });
};
/* shows, tagged, but never counted */
function expectNotCounted(s, d, tag) {
  ok(s.approved === '3' && s.subs === 7 && s.subsAll === 7, tag + ' videos approved counts Instagram only, every clip still in the list', [s.approved, s.subs, s.subsAll]);
  ok(s.mine.length === 6 && s.mine.filter(r => /YouTube not paid \//.test(r)).length === 3 && s.mine.filter(r => /^Vingo \/ Instagram \//.test(r)).length === 2,
     tag + 'b the YouTube clips show in the table, tagged not paid', s.mine);
  ok(s.rej.length === 1 && /^Vingo \/ YouTube not paid/.test(s.rej[0]), tag + 'c the rejected YouTube clip is listed, tagged', s.rej);
  ok(s.plats.join('|') === 'All platforms 3|YouTube 0|Instagram 3', tag + 'd the platform filter offers YouTube with nothing approved on it', s.plats);
  ok(/YouTube clips are not paid on this campaign and do not count as approved \(4 of yours\)\. Only Instagram clips count\./.test(d.note), tag + 'e the campaign page says so', d.note);
  ok(d.k2s === '2 approved clips' && d.k3 === '5' && d.viewsSub === '5 approved clips network-wide', tag + 'f own and network-wide figures are Instagram only', d);
}
/* left off entirely */
function expectHidden(s, d, tag) {
  ok(s.approved === '3' && s.subs === 3 && s.subsAll === 7, tag + ' videos approved counts Instagram only, the four YouTube clips left the working list', [s.approved, s.subs, s.subsAll]);
  ok(s.mine.length === 3 && s.mine.every(r => !/YouTube/.test(r)) && s.mine.filter(r => /^Vingo \/ Instagram/.test(r)).length === 2 && s.mine.some(r => /^Rupee Push/.test(r)),
     tag + 'b submissions table: no YouTube in any status', s.mine);
  ok(s.rej.length === 1 && /Nothing rejected/.test(s.rej[0]), tag + 'c the rejected YouTube clip is not listed', s.rej);
  ok(s.plats.join('|') === 'All platforms 3|Instagram 3', tag + 'd the platform filter does not offer YouTube', s.plats);
  ok(/YouTube clips are not paid on this campaign, so they are not shown here \(4 of yours\)\. Only Instagram clips count\./.test(d.note), tag + 'e the campaign page says so', d.note);
  ok(d.k2s === '2 approved clips' && d.k3 === '5' && d.viewsSub === '5 approved clips network-wide', tag + 'f own and network-wide figures are Instagram only', d);
}
/* nothing unpaid: everything shows and counts */
function expectAllCounted(s, d, tag) {
  ok(s.approved === '5' && s.subs === 7 && s.mine.length === 6 && !s.mine.some(r => /not paid/.test(r)) && s.rej.length === 1 && !/Nothing rejected|not paid/.test(s.rej[0]) && s.plats.join('|') === 'All platforms 5|YouTube 2|Instagram 3',
     tag + ' every clip shows and counts, nothing tagged', s);
  ok(d.note === '' && d.k2s === '4 approved clips' && d.k3 === '9', tag + 'b no note, full network-wide figures', d);
}

(async () => {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });

  /* A: not named, nothing set on the campaign: the default for every creator */
  {
    const { ctx, page } = await boot(browser, base, RATES);
    const sA = await snap(page); await shot(page, 'A-stats', 'stats'); await shot(page, 'A-table', 'stats', '#subMineBody');
    const dA = await detail(page, USD_ID); await shot(page, 'A-campaign', 'campaigns', '#dUnpaid');
    expectNotCounted(sA, dA, 'A');
    const r = await detail(page, INR_ID);
    ok(r.note === '' && r.k2s === '1 approved clip', 'Ag a campaign without a zero-rate platform is untouched', r);
    ok(!page.__errors.length, 'A no page errors', page.__errors);
    await ctx.close();
  }
  /* B: named, mode listed */
  {
    const { ctx, page } = await boot(browser, base, RATES, vingo('listed', ['someone-else', ME]));
    const sB = await snap(page); await shot(page, 'B-stats', 'stats'); await shot(page, 'B-table', 'stats', '#subMineBody');
    const dB = await detail(page, USD_ID); await shot(page, 'B-campaign', 'campaigns', '#dUnpaid');
    expectHidden(sB, dB, 'B');
    ok(!page.__errors.length, 'B no page errors', page.__errors);
    await ctx.close();
  }
  /* B2: named, no mode on the row (older rows): same as listed */
  {
    const { ctx, page } = await boot(browser, base, RATES, vingo(undefined, [ME]));
    const s = await snap(page);
    ok(s.approved === '3' && s.subs === 3, 'B2 a row without a mode treats the names as the ones hidden', [s.approved, s.subs]);
    await ctx.close();
  }
  /* C: all_but_listed, named: shows, not counted */
  {
    const { ctx, page } = await boot(browser, base, RATES, vingo('all_but_listed', [ME]));
    expectNotCounted(await snap(page), await detail(page, USD_ID), 'C');
    await ctx.close();
  }
  /* D: all_but_listed, someone else named: hidden for this creator */
  {
    const { ctx, page } = await boot(browser, base, RATES, vingo('all_but_listed', ['someone-else']));
    expectHidden(await snap(page), await detail(page, USD_ID), 'D');
    await ctx.close();
  }
  /* E: named, but no per-platform rates: nothing is unpaid */
  {
    const { ctx, page } = await boot(browser, base, {}, vingo('listed', [ME]));
    expectAllCounted(await snap(page), await detail(page, USD_ID), 'E');
    await ctx.close();
  }

  await browser.close(); srv.close();
  console.log((fail ? 'FAILED ' : 'OK ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
