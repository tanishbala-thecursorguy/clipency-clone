/* Client portal filters on a mixed-platform campaign: platform chips with
 * counts, a creator list that follows the platform (grouped per platform on
 * All platforms), in Live, Rejected and Review.
 *
 * Run:  PORTAL_DIR=/path/to/clipency-client-portal node tests/client-portal-feed-filters.browser.test.js
 *
 * Live: IG @ig1 x3, @ig2 x1, @both x2; YT @yt1 x2, @both x1.
 * Rejected by the client: IG @ig2 x1, YT @yt1 x2. Waiting: YT @newyt x1, IG @ig1 x2.
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
const H = 3600000;
function clip(handle, plat, status) {
  n++;
  const url = plat === 'YouTube' ? 'https://www.youtube.com/shorts/S' + n : 'https://www.instagram.com/reel/R' + n + '/';
  return { id: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'), campaign_id: CAMP, campaign_title: 'Vingo',
    platform: plat, handle, clip_url: url, views: 1000 * n, likes: 5, comments: 1, status,
    currency: 'USD', fx_rate_per_usd: 1, earned: 2.5, earned_native: 2.5, created_at: '2026-09-1' + (n % 9) + 'T10:00:00Z', flag: null,
    review: status === 'rejected' ? { source: 'client', at: '2026-09-27T09:00:00Z', by_me: true, reason: 'Wrong product or link' } : null };
}
function pend(handle, plat, dueIn) {
  n++;
  return { id: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'), campaign_id: CAMP, campaign_title: 'Vingo', platform: plat, handle,
    clip_url: 'https://www.instagram.com/reel/P' + n + '/', created_at: new Date(Date.now() - 5 * H).toISOString(),
    review_due_at: new Date(Date.now() + dueIn * H).toISOString(), auto_approve_paused: false };
}
const SUBS = [
  clip('@ig1', 'Instagram', 'approved'), clip('@ig1', 'Instagram', 'approved'), clip('@ig1', 'Instagram', 'approved'),
  clip('@ig2', 'Instagram', 'approved'), clip('@both', 'Instagram', 'approved'), clip('@both', 'Instagram', 'approved'),
  clip('@yt1', 'YouTube', 'approved'), clip('@yt1', 'YouTube', 'approved'), clip('@both', 'YouTube', 'approved'),
  clip('@ig2', 'Instagram', 'rejected'), clip('@yt1', 'YouTube', 'rejected'), clip('@yt1', 'YouTube', 'rejected')
];
const PEND = [pend('@newyt', 'YouTube', 20), pend('@ig1', 'Instagram', 10), pend('@ig1', 'Instagram', 30)];
const PAYLOAD = {
  campaigns: [{ id: CAMP, title: 'Vingo', status: 'active', payout_model: 'per_video', currency: 'USD', fx_rate_per_usd: 1,
    rate_per_video: 2.5, rate_per_video_native: 2.5, rpm: 0, rpm_native: 0, budget: 1250, budget_native: 1250,
    created_at: '2026-09-09T00:00:00Z', start_date: '2026-09-09', platform: 'Youtube,instagram', client_review: true, client_review_hours: 48 }],
  submissions: SUBS, pending: PEND, wallet: { currency: 'USD', balance: 0, ledger: [] },
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

async function open(browser, base, query, flagMode, viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1360, height: 900 } });
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
const F = (page, scope, chipsId, selId) => page.evaluate(([scope, chipsId, selId]) => {
  const root = document.querySelector('[data-view="' + scope + '"]');
  const sel = root.querySelector('#' + selId);
  return {
    chips: Array.from(root.querySelectorAll('#' + chipsId + ' .chip')).map(c => (c.classList.contains('on') ? '*' : '') + c.textContent.replace(/\s+/g, ' ').trim()),
    first: sel.options[0] ? sel.options[0].textContent : '',
    groups: Array.from(sel.querySelectorAll('optgroup')).map(g => g.label + ': ' + Array.from(g.children).map(o => o.textContent).join(', ')),
    flat: Array.from(sel.children).filter(e => e.tagName === 'OPTION').slice(1).map(o => o.textContent),
    value: sel.value,
    labels: Array.from(root.querySelectorAll('.fbar .fl')).filter(e => e.getClientRects().length).map(e => e.textContent),
    cards: Array.from(root.querySelectorAll('#clipGrid .clip-card')).filter(c => c.getClientRects().length).map(c => c.querySelector('.ov .t').textContent),
    rows: Array.from(root.querySelectorAll('.rej-row')).filter(c => c.getClientRects().length).map(r => r.querySelector('.c').textContent),
    top: (root.querySelector('#topTitle') || {}).textContent || '',
    note: (root.querySelector('#countNote') || root.querySelector('#revNote') || {}).textContent || '',
    url: location.search
  };
}, [scope, chipsId, selId]);
const feed = page => F(page, 'clips', 'platChips', 'creatorSel');
const rev = page => F(page, 'review', 'revPlat', 'revCreatorSel');
const chip = (page, scope, id, p) => page.click('[data-view="' + scope + '"] #' + id + ' .chip[data-plat="' + p + '"]');

(async () => {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });

  /* ---- Live ---- */
  {
    const { ctx, page } = await open(browser, base, '?view=clips');
    let s = await feed(page);
    ok(s.chips.join('|') === '*All platforms 9|Instagram 6|YouTube 3', 'L1 platform chips with counts, only platforms that have clips', s.chips);
    ok(s.labels.join() === 'Platform,Creator,Sort', 'L1b filter bar is labelled', s.labels);
    if (process.env.SHOT_DIR) {
      await page.evaluate(() => document.querySelector('[data-view="clips"] .fbar').scrollIntoView({ block: 'center' }));
      await page.screenshot({ path: process.env.SHOT_DIR + '/feed-all.png' });
    }
    ok(s.first === 'All creators (4)' && s.groups.length === 2 &&
       s.groups[0] === 'Instagram creators (3): @ig1 · 3 clips, @both · 2 clips, @ig2 · 1 clip' &&
       s.groups[1] === 'YouTube creators (2): @yt1 · 2 clips, @both · 1 clip', 'L2 All platforms: creators grouped under a bar per platform', s);
    await chip(page, 'clips', 'platChips', 'youtube');
    await page.waitForTimeout(200);
    s = await feed(page);
    ok(s.first === 'All YouTube creators (2)' && s.groups.length === 0 && s.flat.join(', ') === '@yt1 · 2 clips, @both · 1 clip', 'L3 YouTube: only creators who posted on YouTube', s);
    if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/feed-yt.png' });
    ok(s.cards.length === 3 && s.top === 'Top performers on YouTube' && /3 of 9 clips on YouTube/.test(s.note), 'L3b grid, top and count follow YouTube', s);
    await chip(page, 'clips', 'platChips', 'instagram');
    await page.waitForTimeout(200);
    s = await feed(page);
    ok(s.first === 'All Instagram creators (3)' && s.flat.every(o => !/@yt1/.test(o)) && s.cards.length === 6, 'L4 Instagram: only Instagram creators', s);
    await chip(page, 'clips', 'platChips', 'youtube');
    await page.selectOption('[data-view="clips"] #creatorSel', 'youtube|@yt1');
    await page.waitForTimeout(200);
    s = await feed(page);
    ok(s.cards.length === 2 && /creator=%40yt1/.test(s.url), 'L5 pick a YouTube creator', s);
    await chip(page, 'clips', 'platChips', 'instagram');
    await page.waitForTimeout(200);
    s = await feed(page);
    ok(s.value === '' && s.cards.length === 6 && !/creator=/.test(s.url), 'L6 switching to a platform they never posted on drops the creator, no empty "0 clips" view', s);
    await chip(page, 'clips', 'platChips', 'all');
    await page.selectOption('[data-view="clips"] #creatorSel', 'youtube|@both');
    await page.waitForTimeout(200);
    s = await feed(page);
    ok(s.chips[2] === '*YouTube 3' && s.cards.length === 1 && /@both/.test(s.cards[0]), 'L7 picking under the YouTube bar shows their YouTube clips', s);
    /* ---- Rejected ---- */
    await page.click('#feedTabs .ft[data-tab="rejected"]');
    await page.waitForTimeout(250);
    s = await feed(page);
    ok(s.chips.join('|') === 'All platforms 3|Instagram 1|*YouTube 2' && s.value === '' && s.rows.length === 2 && s.rows.every(r => /@yt1/.test(r)),
       'R1 Rejected: chips count rejected clips; a creator with nothing rejected is dropped', s);
    ok(s.labels.join() === 'Platform,Creator', 'R1b no sort on the Rejected tab', s.labels);
    ok(s.flat.join(', ') === '@yt1 · 2 clips', 'R2 Rejected + YouTube: only YouTube creators with rejected clips', s.flat);
    await chip(page, 'clips', 'platChips', 'all');
    await page.waitForTimeout(200);
    s = await feed(page);
    ok(s.groups.join(' / ') === 'Instagram creators (1): @ig2 · 1 clip / YouTube creators (1): @yt1 · 2 clips', 'R3 Rejected, All platforms: grouped per platform', s.groups);
    ok(!page.__errors.length, 'L9 no page errors', page.__errors);
    await ctx.close();
  }
  /* a link to a creator who has nothing in that tab */
  {
    const { ctx, page } = await open(browser, base, '?view=clips&tab=rejected&creator=%40ig1');
    const s = await feed(page);
    ok(s.value === '' && s.rows.length === 3 && !/creator=/.test(s.url), 'R4 a creator with nothing rejected is not left as a dead filter', s);
    await ctx.close();
  }
  /* ---- Review ---- */
  {
    const { ctx, page } = await open(browser, base, '?view=review');
    let s = await rev(page);
    ok(s.chips.join('|') === '*All platforms 3|Instagram 2|YouTube 1', 'V1 Review chips with counts', s.chips);
    ok(s.groups.join(' / ') === 'Instagram creators (1): @ig1 · 2 clips / YouTube creators (1): @newyt · 1 clip', 'V2 Review creators grouped per platform', s.groups);
    ok(s.labels.join() === 'Platform,Creator', 'V2b Review filter bar is labelled', s.labels);
    await chip(page, 'review', 'revPlat', 'youtube');
    await page.waitForTimeout(200);
    s = await rev(page);
    ok(s.rows.length === 1 && /@newyt/.test(s.rows[0]) && s.flat.join() === '@newyt · 1 clip' && /1 waiting on YouTube/.test(s.note), 'V3 Review YouTube: only YouTube creators and clips', s);
    await chip(page, 'review', 'revPlat', 'all');
    await page.selectOption('[data-view="review"] #revCreatorSel', 'instagram|@ig1');
    await page.waitForTimeout(200);
    s = await rev(page);
    ok(s.chips[1] === '*Instagram 2' && s.rows.length === 2 && s.rows.every(r => /@ig1/.test(r)), 'V4 picking under the Instagram bar shows their Instagram clips', s);
    ok(!page.__errors.length, 'V5 no page errors', page.__errors);
    await ctx.close();
  }

  /* ---- the picker panel: a platform bar that counts creators, search, the
     names; the <select> underneath stays the model and must agree ---- */
  const P = (page, scope, prefix, chipsId) => page.evaluate(([scope, prefix, chipsId]) => {
    const root = document.querySelector('[data-view="' + scope + '"]');
    const pop = root.querySelector('#' + prefix + 'Pop'), pick = root.querySelector('#' + prefix + 'Pick');
    const t = e => e.textContent.replace(/\s+/g, ' ').trim();
    return {
      open: !pop.hidden, expanded: root.querySelector('#' + prefix + 'Btn').getAttribute('aria-expanded'),
      btn: t(root.querySelector('#' + prefix + 'Btn .cp-txt')), on: pick.classList.contains('on'),
      dot: pick.querySelector('.cp-dot').hidden ? '' : pick.querySelector('.cp-dot').className,
      segs: Array.from(pop.querySelectorAll('.cp-seg button')).map(b => (b.classList.contains('on') ? '*' : '') + t(b)),
      rows: Array.from(pop.querySelectorAll('.cp-list li')).map(li => (li.classList.contains('sel') ? '*' : '') + (li.classList.contains('hov') ? '>' : '') + t(li)),
      foot: t(pop.querySelector('.cp-n')),
      fixed: getComputedStyle(pop).position, done: !!pop.querySelector('.cp-done').getClientRects().length, scrim: !!pick.querySelector('.cp-scrim').getClientRects().length,
      chips: Array.from(root.querySelectorAll('#' + chipsId + ' .chip')).map(c => (c.classList.contains('on') ? '*' : '') + t(c)),
      cards: Array.from(root.querySelectorAll('#clipGrid .clip-card')).filter(c => c.getClientRects().length).map(c => c.querySelector('.ov .t').textContent),
      rowsR: Array.from(root.querySelectorAll('.rej-row')).filter(c => c.getClientRects().length).map(r => r.querySelector('.c').textContent),
      selValue: root.querySelector('#' + prefix + 'Sel').value,
      url: location.search,
      focus: document.activeElement ? document.activeElement.tagName + (document.activeElement.id ? '#' + document.activeElement.id : '') : ''
    };
  }, [scope, prefix, chipsId]);
  {
    const { ctx, page } = await open(browser, base, '?view=clips');
    const feedP = () => P(page, 'clips', 'creator', 'platChips');
    const click = sel => page.click('[data-view="clips"] ' + sel);
    let s = await feedP();
    ok(!s.open && s.expanded === 'false' && s.btn === 'All creators' && !s.on, 'P0 closed pill reads All creators', s);
    await click('#creatorBtn'); await page.waitForTimeout(150);
    s = await feedP();
    ok(s.open && s.expanded === 'true' && s.segs.join('|') === '*All 4|Instagram 3|YouTube 2', 'P1 opens with a platform bar that counts creators', s);
    ok(s.rows.join(' / ') === '*✓ All creators 9 clips / b @both IG 2 YT 1 / i @ig1 IG 3 / y @yt1 YT 2 / i @ig2 IG 1' && s.foot === '4 creators' && s.focus === 'INPUT',
       'P2 All: every creator with where they post, search focused', s);
    if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/picker-all.png' });
    await click('#creatorPop .cp-seg [data-seg="youtube"]'); await page.waitForTimeout(100);
    s = await feedP();
    ok(s.segs[2] === '*YouTube 2' && s.rows.join(' / ') === '2 All YouTube creators 3 clips / y @yt1 2 clips / b @both 1 clip' && s.chips[0] === '*All platforms 9' && s.cards.length === 9,
       'P3 the bar inside only changes the list, the page is untouched', s);
    await page.type('[data-view="clips"] #creatorPop input', 'bot'); await page.waitForTimeout(100);
    s = await feedP();
    ok(s.rows.join(' / ') === '>b @both 1 clip' && s.foot === '1 of 2 match', 'P4 search narrows and highlights the first match', s);
    if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/picker-search.png' });
    await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    s = await feedP();
    ok(!s.open && s.on && s.btn === '@both' && /youtube/.test(s.dot) && s.chips[2] === '*YouTube 3' && s.cards.length === 1 && /creator=%40both/.test(s.url) &&
       s.selValue === 'youtube|@both' && s.focus === 'BUTTON#creatorBtn',
       'P5 Enter picks: creator and platform set, the select underneath agrees, focus back on the pill', s);
    if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/picker-picked.png' });
    await click('#creatorBtn'); await page.waitForTimeout(150);
    s = await feedP();
    ok(s.segs[2] === '*YouTube 2' && s.rows[2] === '*b @both 1 clip', 'P6 reopens on the current platform with the pick marked', s);
    await click('#creatorPop .cp-seg [data-seg="all"]'); await page.waitForTimeout(100);
    await click('#creatorPop .cp-list li[data-i="1"]'); await page.waitForTimeout(200);
    s = await feedP();
    ok(!s.open && s.btn === '@both' && s.dot === '' && s.chips[0] === '*All platforms 9' && s.cards.length === 3 && s.selValue === 'all|@both' && /creator=%40both/.test(s.url),
       'P7 picking under All keeps every platform for that creator', s);
    await click('#creatorBtn'); await page.waitForTimeout(100);
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);
    s = await feedP();
    ok(!s.open && s.focus === 'BUTTON#creatorBtn' && s.btn === '@both', 'P8 Escape closes without changing anything', s);
    await click('#creatorClear'); await page.waitForTimeout(200);
    s = await feedP();
    ok(!s.on && s.btn === 'All creators' && s.cards.length === 9 && !/creator=/.test(s.url) && s.selValue === '', 'P9 the × clears', s);
    await click('#creatorBtn'); await page.waitForTimeout(100);
    await page.mouse.click(10, 10); await page.waitForTimeout(100);
    s = await feedP();
    ok(!s.open, 'P10 a click outside closes', s);
    ok(!page.__errors.length, 'P11 no page errors', page.__errors);
    await ctx.close();
  }
  /* Rejected tab: the filter bar sits low, so the open panel must scroll into
     view below the bar, never flip up under the sticky header */
  {
    /* a short window: the panel cannot fit below the bar without scrolling */
    const { ctx, page } = await open(browser, base, '?view=clips&tab=rejected', 'ok', { width: 1360, height: 560 });
    await page.click('[data-view="clips"] #creatorBtn'); await page.waitForTimeout(800);
    const g = await page.evaluate(() => {
      const pop = document.querySelector('[data-view="clips"] #creatorPop'), pill = document.querySelector('[data-view="clips"] #creatorBtn');
      const r = pop.getBoundingClientRect(), b = pill.getBoundingClientRect();
      const tb = document.querySelector('.topbar');
      const headerBottom = tb ? tb.getBoundingClientRect().bottom : 0;
      const seg = pop.querySelector('.cp-seg [data-seg="instagram"]'), sr = seg.getBoundingClientRect();
      const hit = document.elementFromPoint(sr.left + sr.width / 2, sr.top + sr.height / 2);
      return { top: r.top, bottom: r.bottom, pillBottom: b.bottom, headerBottom, vh: innerHeight, segClickable: !!(hit && seg.contains(hit)), up: pop.classList.contains('up') };
    });
    ok(g.top > g.pillBottom && !g.up, 'J1 the panel opens below the pill, never upward', g);
    ok(g.top >= g.headerBottom && g.bottom <= g.vh + 1, 'J2 the whole panel is on screen after opening (page scrolled, header not covering it)', g);
    ok(g.segClickable, 'J3 the platform bar can be clicked', g);
    await page.click('[data-view="clips"] #creatorPop .cp-seg [data-seg="instagram"]'); await page.waitForTimeout(100);
    await page.click('[data-view="clips"] #creatorPop .cp-list li[data-i="1"]'); await page.waitForTimeout(250);
    const s = await P(page, 'clips', 'creator', 'platChips');
    ok(!s.open && s.on && s.btn === '@ig2' && s.rowsR.length === 1 && /@ig2/.test(s.rowsR[0]), 'J4 picking on the Rejected tab filters the rejected list', s);
    ok(!page.__errors.length, 'J5 no page errors', page.__errors);
    await ctx.close();
  }
  /* on a phone the panel is a bottom sheet */
  {
    const { ctx, page } = await open(browser, base, '?view=clips', 'ok', { width: 390, height: 800 });
    await page.click('[data-view="clips"] #creatorBtn'); await page.waitForTimeout(150);
    let s = await P(page, 'clips', 'creator', 'platChips');
    ok(s.open && s.fixed === 'fixed' && s.done && s.scrim, 'M1 on a phone the panel is a sheet with a scrim and Done', s);
    if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/picker-phone.png' });
    await page.click('[data-view="clips"] #creatorPop .cp-done'); await page.waitForTimeout(100);
    s = await P(page, 'clips', 'creator', 'platChips');
    ok(!s.open, 'M2 Done closes the sheet', s);
    await ctx.close();
  }
  /* the Review page has the same picker */
  {
    const { ctx, page } = await open(browser, base, '?view=review');
    await page.click('[data-view="review"] #revCreatorBtn'); await page.waitForTimeout(150);
    let s = await P(page, 'review', 'revCreator', 'revPlat');
    ok(s.open && s.segs.join('|') === '*All 2|Instagram 1|YouTube 1' && s.rows.join(' / ') === '*✓ All creators 3 clips / i @ig1 IG 2 / n @newyt YT 1', 'W1 Review picker: bar and names', s);
    await page.click('[data-view="review"] #revCreatorPop .cp-seg [data-seg="instagram"]'); await page.waitForTimeout(100);
    await page.click('[data-view="review"] #revCreatorPop .cp-list li[data-i="1"]'); await page.waitForTimeout(200);
    s = await P(page, 'review', 'revCreator', 'revPlat');
    ok(!s.open && s.btn === '@ig1' && s.chips[1] === '*Instagram 2' && s.rowsR.length === 2 && s.rowsR.every(r => /@ig1/.test(r)), 'W2 picking under Instagram shows their waiting clips', s);
    ok(!page.__errors.length, 'W3 no page errors', page.__errors);
    await ctx.close();
  }

  await browser.close(); srv.close();
  console.log((fail ? 'FAILED ' : 'OK ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
