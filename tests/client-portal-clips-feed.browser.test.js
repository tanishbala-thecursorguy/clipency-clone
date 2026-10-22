/* Client portal Clips Feed: creator filter, Rejected tab, repeat flags.
 *
 * Run:  PORTAL_DIR=/path/to/clipency-client-portal node tests/client-portal-clips-feed.browser.test.js
 *
 * Vingo, per video at $2.50. Live: @alpha x3, @beta x2, plus one @alpha clip
 * that was flagged and restored (dismissed). Flagged: one @alpha clip under
 * review. Rejected: one @beta clip Clipency upheld.
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
function clip(handle, views, status, flag) {
  n++;
  return { id: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'), campaign_id: CAMP, campaign_title: 'Vingo',
    platform: 'Instagram', handle, clip_url: 'https://instagram.com/reel/' + n, views, likes: 5, comments: 1,
    status, currency: 'USD', fx_rate_per_usd: 1, earned: 2.5, earned_native: 2.5,
    created_at: '2026-09-1' + (n % 9) + 'T10:00:00Z', flag: flag || null };
}
const SUBS = [
  clip('@alpha', 9000, 'approved'), clip('@alpha', 7000, 'approved'), clip('@alpha', 500, 'approved'),
  clip('@beta', 8000, 'approved'), clip('@beta', 300, 'approved'),
  clip('@alpha', 400, 'approved', { id: 'f-d', reason: 'Wrong product or link', by: 'client@example.com', by_me: true,
    resolution: 'dismissed', note: 'Link is correct, restored.', at: '2026-09-18T10:00:00Z', resolved_at: '2026-09-19T10:00:00Z' }),
  clip('@alpha', 6000, 'flagged', { id: 'f-o', reason: "Doesn't fit our brand", by: 'client@example.com', by_me: true,
    resolution: 'open', note: null, at: '2026-09-23T01:51:06Z', resolved_at: null }),
  clip('@beta', 2000, 'rejected', { id: 'f-u', reason: 'Low quality / poor edit', by: 'boss@brand.com', by_me: false,
    resolution: 'upheld', note: 'Agreed, off brand', at: '2026-09-20T10:00:00Z', resolved_at: '2026-09-21T10:00:00Z' })
];
const PAYLOAD = {
  campaigns: [{ id: CAMP, title: 'Vingo', status: 'active', payout_model: 'per_video', currency: 'USD', fx_rate_per_usd: 1,
    rate_per_video: 2.5, rate_per_video_native: 2.5, rpm: 0, rpm_native: 0, budget: 1250, budget_native: 1250,
    created_at: '2026-09-09T00:00:00Z', start_date: '2026-09-09', platform: 'Instagram' }],
  submissions: SUBS, wallet: { currency: 'USD', balance: 0, ledger: [] },
  fx: { rates: { USD: 1, INR: 95.82 }, as_of: '2026-09-21' }, totals: {}
};
const STUB = `
window.supabase = { createClient: function(){ return {
  auth: { getUser: async function(){ return {data:{user:{id:'client-1',email:'client@example.com'}}}; },
          getSession: async function(){ return {data:{session:{user:{id:'client-1'}}}}; },
          signOut: async function(){ return {}; },
          onAuthStateChange: function(){ return {data:{subscription:{unsubscribe:function(){}}}}; } },
  rpc: async function(name, args){
    (window.__RPC = window.__RPC || []).push({name:name, args:args});
    if (name === 'client_dashboard_data') return {data: window.__PAYLOAD, error: null};
    if (name === 'client_flag_clip') {
      var m = window.__FLAG_MODE;
      if (m === 'already-error') return {data:null, error:{message:'this clip is already flagged'}};
      if (m === 'already-data') return {data:{flag_id:'f-x', status:'flagged', already:true}, error:null};
      if (m === 'other-error') return {data:null, error:{message:'this campaign is not on your dashboard'}};
      return {data:{flag_id:'f-new', status:'flagged'}, error:null};
    }
    return {data:null, error:null};
  },
  from: function(){ var q = {select:function(){return q;}, eq:function(){return q;}, order:function(){return q;},
    in:function(){return q;}, limit:function(){return q;}, maybeSingle:async function(){return {data:null,error:null};},
    then:function(r){ return Promise.resolve({data:[],error:null}).then(r); }}; return q; }
}; } };`;

async function open(browser, base, query, flagMode) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (/supabase-js@2/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    return route.abort();
  });
  await ctx.addInitScript(({ p, m }) => {
    try { localStorage.setItem('sb-spwtkdgpgeutrhwcjrpy-auth-token', '{"fake":1}'); localStorage.setItem('clipency-tour-seen', '1');
          Object.keys(localStorage).filter(k => k.indexOf('clipency-flags-') === 0).forEach(k => localStorage.removeItem(k)); } catch (e) {}
    window.__PAYLOAD = p; window.__FLAG_MODE = m;
  }, { p: PAYLOAD, m: flagMode || 'ok' });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await page.goto(base + 'campaign.html' + query);
  await page.waitForFunction(() => window.CLIPENCY_LIVE && window.CLIPENCY_LIVE.mode === 'live', null, { timeout: 15000 });
  await page.waitForTimeout(600);
  return { ctx, page };
}
/* What the client actually SEES. The old checks read el.hidden, which was
   true while CSS (display:grid / display:flex) kept the element on screen:
   the Rejected tab showed every live clip underneath and the tests passed. */
const state = page => page.evaluate(() => { const vis = id => { const e = document.getElementById(id);
  return !!(e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'); }; return ({
  live: document.getElementById('ftLive').textContent, rej: document.getElementById('ftRej').textContent,
  opts: Array.from(document.querySelectorAll('#creatorSel option')).map(o => o.textContent),
  sel: document.getElementById('creatorSel').value,
  cards: Array.from(document.querySelectorAll('#clipGrid .clip-card')).map(c => c.querySelector('.ov .t').textContent),
  gridHidden: !vis('clipGrid'), rejHidden: !vis('rejList'),
  topHidden: !vis('topSection'), sortHidden: !vis('sortChips'),
  visibleCards: Array.from(document.querySelectorAll('#clipGrid .clip-card')).filter(c => c.getClientRects().length).length,
  rejRowH: Math.max(0, ...Array.from(document.querySelectorAll('#rejList .rej-row')).map(r => r.getBoundingClientRect().height)),
  visibleRej: Array.from(document.querySelectorAll('#rejList .rej-row')).filter(c => c.getClientRects().length).length,
  topTitle: document.getElementById('topTitle').textContent,
  top: Array.from(document.querySelectorAll('#top3 .top-card .c')).map(c => c.textContent),
  note: document.getElementById('countNote').textContent,
  rows: Array.from(document.querySelectorAll('#rejList .rej-row')).map(r => ({
    who: r.querySelector('.c').textContent, pill: r.querySelector('.rs').textContent,
    why: r.querySelector('.why').textContent, note: (r.querySelector('.note') || {}).textContent || '' })),
  url: location.search, clear: !document.getElementById('creatorClear').hidden
}); });

(async () => {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });

  /* 1. live tab + creator filter */
  {
    const { ctx, page } = await open(browser, base, '?view=clips');
    let s = await state(page);
    ok(s.live === '6' && s.rej === '3', 'F1 tab counts: 6 live, 3 flagged', s);
    ok(s.opts[0] === 'All creators (2)' && s.opts[1] === '@alpha · 4 clips' && s.opts[2] === '@beta · 2 clips', 'F2 creators by clip count', s.opts);
    ok(s.cards.length === 6 && s.topTitle === 'Top performers' && s.rejHidden && !s.gridHidden, 'F3 default: every live clip', s);
    await page.selectOption('#creatorSel', 'instagram|@beta');
    await page.waitForTimeout(200);
    s = await state(page);
    ok(s.cards.length === 2 && s.cards.every(t => /@beta/.test(t)), 'F4 only @beta clips', s.cards);
    ok(s.topTitle === 'Top clips from @beta' && s.top.length === 2 && s.top.every(t => /@beta/.test(t)), 'F5 top performers follow the filter', s);
    ok(/2 of 6 clips · @beta/.test(s.note) && /creator=%40beta/.test(s.url) && s.clear, 'F6 count, address and clear button', s);
    await page.click('#creatorClear');
    await page.waitForTimeout(200);
    s = await state(page);
    ok(s.cards.length === 6 && s.sel === '' && !/creator=/.test(s.url) && !s.clear, 'F7 clear shows everyone again', s);
    // platform + creator together
    const chips = await page.$$eval('[data-view="clips"] #platChips .chip', cs => cs.map(c => c.dataset.plat));
    ok(chips.join() === 'all,instagram', 'F8 no YouTube chip when nothing was posted there', chips);
    ok(!page.__errors.length, 'F9 no page errors', page.__errors);
    await ctx.close();
  }

  /* 2. deep link from the Creators tab */
  {
    const { ctx, page } = await open(browser, base, '?view=creators');
    const href = await page.$eval('#crTbl a.cr-clips', a => a.getAttribute('href'));
    ok(/view=clips&creator=%40/.test(href), 'F10 Creators tab links to the filtered feed', href);
    await page.goto(base + 'campaign.html' + href);
    await page.waitForFunction(() => window.CLIPENCY_LIVE && window.CLIPENCY_LIVE.mode === 'live');
    await page.waitForTimeout(600);
    const s = await state(page);
    const who = s.sel.split('|')[1];
    ok(/^all\|@/.test(s.sel) && s.cards.length && s.cards.every(t => t.indexOf(who) > -1), 'F11 link opens with the creator applied', s);
    await ctx.close();
  }

  /* 3. Rejected tab */
  {
    const { ctx, page } = await open(browser, base, '?view=clips');
    await page.click('#feedTabs .ft[data-tab="rejected"]');
    await page.waitForTimeout(200);
    let s = await state(page);
    ok(!s.rejHidden && s.gridHidden && s.topHidden && s.sortHidden && s.visibleCards === 0, 'F12 Rejected tab replaces the grid (nothing live on screen)', s);
    ok(s.rows.length === 3, 'F13 three flagged clips', s.rows);
    ok(s.rejRowH > 60 && s.rejRowH < 260, 'F13b rejected rows are compact cards, not page-tall', s.rejRowH);
    ok(s.rows[0].pill === 'Under review' && /Flagged by you/.test(s.rows[0].why) && /not billed while Clipency reviews/.test(s.rows[0].why), 'F14 newest first, under review', s.rows[0]);
    const up = s.rows.find(r => r.pill === 'Rejected'), dm = s.rows.find(r => r.pill === 'Restored');
    ok(up && /boss@brand\.com/.test(up.why) && /Agreed, off brand/.test(up.note), 'F15 upheld: who flagged + Clipency note', up);
    ok(dm && /put it back in your feed/.test(dm.why), 'F16 dismissed: restored', dm);
    ok(/3 flagged · 1 under review/.test(s.note) && /tab=rejected/.test(s.url), 'F17 count note + address', s);
    ok(s.opts[0] === 'All creators (2)' && /@alpha · 2 clips/.test(s.opts.join('|')), 'F18 creator list counts this tab', s.opts);
    await page.selectOption('#creatorSel', 'instagram|@beta');
    await page.waitForTimeout(200);
    s = await state(page);
    ok(s.rows.length === 1 && s.rows[0].pill === 'Rejected' && s.visibleCards === 0 && s.visibleRej === 1, 'F19 creator filter works on this tab, no live clips shown', s);
    await page.reload();
    await page.waitForFunction(() => window.CLIPENCY_LIVE && window.CLIPENCY_LIVE.mode === 'live');
    await page.waitForTimeout(600);
    s = await state(page);
    ok(!s.rejHidden && s.rows.length === 1 && s.visibleCards === 0, 'F20 tab + creator survive reload', s);
    // back to Live: no rejected information under the live grid
    await page.click('#feedTabs .ft[data-tab="live"]');
    await page.waitForTimeout(200);
    s = await state(page);
    ok(s.rejHidden && s.visibleRej === 0 && !s.gridHidden && s.visibleCards > 0, 'F20b Live tab shows no rejected clips', s);
    await page.click('#feedTabs .ft[data-tab="rejected"]');
    await page.waitForTimeout(200);
    // spend counts live clips only: 6 approved x $2.50
    await page.evaluate(() => CX.go('overview'));
    await page.waitForTimeout(2300);
    const spend = await page.$eval('#stSpend', e => e.textContent.trim());
    ok(spend === '$15.00', 'F21 flagged and rejected clips are not billed', spend);
    ok(!page.__errors.length, 'F22 no page errors', page.__errors);
    await ctx.close();
  }

  /* 3b. the rejected clip card */
  {
    const { ctx, page } = await open(browser, base, '?view=clips&tab=rejected');
    const card = () => page.evaluate(() => { const q = id => document.getElementById(id);
      return { open: q('rdScrim').classList.contains('open'), eb: q('rdEyebrow').textContent, title: q('rdTitle').textContent,
        reason: q('rdReason').textContent, who: q('rdWho').textContent, note: q('rdNote').hidden ? '' : q('rdNote').textContent,
        kpis: Array.from(document.querySelectorAll('#rdKpis .rd-kpi')).map(k => k.querySelector('.l').textContent + '=' + k.querySelector('.v').textContent),
        href: q('rdOpen').getAttribute('href'), url: q('rdUrl').textContent, linkShown: !!q('rdOpen').getClientRects().length }; });
    const up = page.locator('#rejList .rej-row', { hasText: 'Low quality' });
    const upId = await up.getAttribute('data-id');
    await up.locator('.why').click();
    await page.waitForTimeout(250);
    let c = await card();
    const src = SUBS.find(x => x.id === upId);
    ok(c.open && c.eb === 'Rejected' && c.title === 'Taken off your campaign.', 'F30 clicking a rejected clip opens its card', c);
    ok(c.reason === 'Low quality / poor edit' && /boss@brand\.com/.test(c.who) && /Agreed, off brand/.test(c.note), 'F31 card shows the reason, who, Clipency note', c);
    ok(c.kpis.length === 4 && /^Views=\S+$/.test(c.kpis[0]) && c.kpis[0] !== 'Views=0' && /^Likes=5$/.test(c.kpis[1]) &&
       /^Submitted=\d+ \w+$/.test(c.kpis[2]) && c.kpis[3] === 'Decided=21 Sept', 'F32 card has the numbers', c.kpis);
    ok(c.href === src.clip_url && c.url === src.clip_url && c.linkShown, 'F33 open link is the post', c);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    c = await card();
    ok(!c.open, 'F34 Escape closes it', c);
    // keyboard + "Open post" link on the row does not open the card
    await page.focus('#rejList .rej-row');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    c = await card();
    ok(c.open && c.eb === 'Under review', 'F35 Enter opens the card; open flag reads Under review', c);
    await page.click('#rdClose');
    const pop = page.waitForEvent('popup', { timeout: 3000 }).catch(() => null);
    await page.locator('#rejList .rej-row .rj-side a').first().click();
    const p2 = await pop; if (p2) await p2.close().catch(() => {});
    c = await card();
    ok(!c.open, 'F36 the row link opens the post, not the card', c);
    ok(!page.__errors.length, 'F37 no page errors', page.__errors);
    await ctx.close();
  }

  /* 4. approved clips can no longer be flagged: no flag option, no rpc */
  {
    const { ctx, page } = await open(browser, base, '?view=clips', 'ok');
    const card = page.locator('#clipGrid .clip-card').first();
    await card.hover();
    await card.locator('.clip-menu-btn').click();
    await page.waitForTimeout(200);
    const m = await page.evaluate(() => ({
      flag: document.querySelectorAll('#clipGrid .mi-flag').length,
      locked: document.querySelectorAll('#clipGrid .mi-locked').length,
      rpc: (window.__RPC || []).filter(r => r.name === 'client_flag_clip').length }));
    ok(m.flag === 0 && m.locked > 0 && m.rpc === 0, 'F23 approved clips show "can\'t be flagged", never the flag option', m);
    const s = await state(page);
    ok(s.live === '6' && s.rej === '3', 'F24 nothing moves between Live and Rejected', s);
    ok(!page.__errors.length, 'F28 no page errors', page.__errors);
    await ctx.close();
  }

  await browser.close(); srv.close();
  console.log((fail ? 'FAILED ' : 'OK ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
