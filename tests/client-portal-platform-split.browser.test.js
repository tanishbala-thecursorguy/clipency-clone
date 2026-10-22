/* One dashboard per platform (campaigns.platform_split).
 *
 * A campaign on Instagram and YouTube with platform_split = 'instagram' shows
 * up in the client portal as two campaigns: "Vingo · Instagram" with the
 * budget, "Vingo · YouTube" without one, each dashboard holding only that
 * platform's clips, reviews and creators. The money is not split: the budget
 * bar reads campaign-wide wherever the budget is shown.
 *
 * Run:  PORTAL_DIR=/path/to/clipency-client-portal node tests/client-portal-platform-split.browser.test.js
 *
 * Live: IG @ig1 x3, @ig2 x1, @both x2; YT @yt1 x2, @both x1 (9 approved, 2.50 each).
 * Rejected by the client: IG @ig2 x1. Waiting: YT @newyt x1, IG @ig1 x2.
 * Then the same campaign with a budget per platform (platform_budgets) and a
 * brand price per platform (client_platform_rates).
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
  return { id: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'), campaign_id: CAMP, campaign_title: 'Vingo {UGC Campaign}',
    platform: plat, handle, clip_url: url, views: 1000 * n, likes: 5, comments: 1, status,
    currency: 'USD', fx_rate_per_usd: 1, earned: 2.5, earned_native: 2.5, created_at: '2026-09-1' + (n % 9) + 'T10:00:00Z', flag: null,
    review: status === 'rejected' ? { source: 'client', at: '2026-09-27T09:00:00Z', by_me: true, reason: 'Wrong product or link' } : null };
}
function pend(handle, plat, dueIn) {
  n++;
  return { id: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'), campaign_id: CAMP, campaign_title: 'Vingo {UGC Campaign}', platform: plat, handle,
    clip_url: 'https://www.instagram.com/reel/P' + n + '/', created_at: new Date(Date.now() - 5 * H).toISOString(),
    review_due_at: new Date(Date.now() + dueIn * H).toISOString(), auto_approve_paused: false };
}
const SUBS = [
  clip('@ig1', 'Instagram', 'approved'), clip('@ig1', 'Instagram', 'approved'), clip('@ig1', 'Instagram', 'approved'),
  clip('@ig2', 'Instagram', 'approved'), clip('@both', 'Instagram', 'approved'), clip('@both', 'Instagram', 'approved'),
  clip('@yt1', 'YouTube', 'approved'), clip('@yt1', 'YouTube', 'approved'), clip('@both', 'YouTube', 'approved'),
  clip('@ig2', 'Instagram', 'rejected')
];
const PEND = [pend('@newyt', 'YouTube', 20), pend('@ig1', 'Instagram', 10), pend('@ig1', 'Instagram', 30)];
const CAMPAIGN = { id: CAMP, title: 'Vingo {UGC Campaign}', brand_name: 'Vingo', genre: 'UGC', status: 'active', payout_model: 'per_video', currency: 'USD', fx_rate_per_usd: 1,
  rate_per_video: 2.5, rate_per_video_native: 2.5, rpm: 0, rpm_native: 0, budget: 1250, budget_native: 1250,
  created_at: '2026-09-08T00:00:00Z', start_date: '2026-09-08', platform: 'Youtube,instagram', client_review: true, client_review_hours: 48,
  platform_split: 'instagram' };
const PAYLOAD = {
  campaigns: [CAMPAIGN], submissions: SUBS, pending: PEND, wallet: { currency: 'USD', balance: 0, ledger: [] },
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
    return {data:null, error:null};
  },
  from: function(){ var q = {select:function(){return q;}, eq:function(){return q;}, order:function(){return q;},
    in:function(){return q;}, limit:function(){return q;}, maybeSingle:async function(){return {data:null,error:null};},
    then:function(r){ return Promise.resolve({data:[],error:null}).then(r); }}; return q; }
}; } };`;

async function open(browser, base, page_, query, payload) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (/supabase-js@2/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    return route.abort();
  });
  await ctx.addInitScript(({ p }) => {
    try { localStorage.setItem('sb-spwtkdgpgeutrhwcjrpy-auth-token', '{"fake":1}'); localStorage.setItem('clipency-tour-seen', '1');
          /* a clean store on the first page of each context only: the card's
             "Open dashboard" hands the chosen half to the next page through it */
          if (!sessionStorage.getItem('__split_test_init')) { localStorage.removeItem('clipency-store-v2'); sessionStorage.setItem('__split_test_init', '1'); }
          sessionStorage.removeItem('clipency-live-v2');
          Object.keys(localStorage).filter(k => k.indexOf('clipency-flags-') === 0).forEach(k => localStorage.removeItem(k)); } catch (e) {}
    window.__PAYLOAD = p;
  }, { p: payload || PAYLOAD });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await page.goto(base + page_ + (query || ''));
  /* 'empty' = signed in, campaigns loaded, no clips yet */
  await page.waitForFunction(() => window.CLIPENCY_LIVE && /^(live|empty)$/.test(window.CLIPENCY_LIVE.mode), null, { timeout: 15000 });
  await page.waitForTimeout(600);
  return { ctx, page };
}
const t = s => String(s || '').replace(/\s+/g, ' ').trim();
const home = page => page.evaluate(() => {
  const t = s => String(s || '').replace(/\s+/g, ' ').trim();
  return {
    summary: t(document.getElementById('homeSummary').textContent),
    spend: t(document.getElementById('pSpend').textContent), spendFoot: t(document.getElementById('pSpendFoot').textContent),
    running: t(document.getElementById('pRunning').textContent), count: t(document.getElementById('campCount').textContent),
    cards: Array.from(document.querySelectorAll('#camps .camp')).map(c => ({
      id: c.dataset.id, name: t(c.querySelector('.camp-name h3').textContent),
      plats: t(c.querySelector('.camp-plats').textContent),
      budget: t((c.querySelector('.camp-budget') || {}).textContent), noBudget: !!c.querySelector('.camp-nobudget'),
      banner: c.querySelector('.camp-banner').getAttribute('style'), tinted: !!c.querySelector('.camp-bg'),
      bannerClass: c.querySelector('.camp-banner').className,
      clips: t(c.querySelectorAll('.cn b')[1].textContent), views: t(c.querySelectorAll('.cn b')[0].textContent),
      code: t((c.querySelector('.code') || {}).textContent)
    }))
  };
});
const camp = page => page.evaluate(() => {
  const t = s => String(s || '').replace(/\s+/g, ' ').trim();
  const root = document.querySelector('[data-view="clips"]');
  return {
    chip: t((document.querySelector('.client-chip') || {}).textContent),
    stBudget: t((document.getElementById('stBudget') || {}).textContent), stBudgetFoot: t((document.getElementById('stBudgetFoot') || {}).textContent),
    stClips: t((document.getElementById('stClips') || {}).textContent), stClipsFoot: t((document.getElementById('stClipsFoot') || {}).textContent),
    stSpend: t((document.getElementById('stSpend') || {}).textContent),
    cards: Array.from(root.querySelectorAll('#clipGrid .clip-card')).filter(c => c.getClientRects().length).map(c => t(c.querySelector('.ov .t').textContent)),
    chips: Array.from(root.querySelectorAll('#platChips .chip')).map(c => (c.classList.contains('on') ? '*' : '') + t(c.textContent)),
    creators: Array.from(root.querySelectorAll('#creatorSel option')).map(o => t(o.textContent)),
    pendingRows: Array.from(document.querySelectorAll('[data-view="review"] .rej-row')).filter(c => c.getClientRects().length).map(r => t(r.querySelector('.c').textContent)),
    rejected: Array.from(root.querySelectorAll('#rejList .rej-row')).filter(c => c.getClientRects().length).map(r => t(r.querySelector('.c').textContent)),
    badge: t((document.querySelector('.snav a[data-nav="review"] .navcount') || {}).textContent),
    url: location.search
  };
});

(async () => {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });

  /* ---- Home: two cards from one campaign ---- */
  {
    const { ctx, page } = await open(browser, base, 'home.html');
    const s = await home(page);
    ok(s.cards.length === 2 && s.cards[0].name === 'Vingo · Instagram' && s.cards[1].name === 'Vingo · YouTube', 'H1 one campaign, two cards, the budget side first', s.cards.map(c => c.name));
    ok(s.cards[0].id === CAMP + ':instagram' && s.cards[1].id === CAMP + ':youtube', 'H2 cards carry the platform in their id', s.cards.map(c => c.id));
    ok(s.cards[0].plats === 'Instagram' && s.cards[1].plats === 'YouTube', 'H3 each card lists only its platform', s.cards.map(c => c.plats));
    ok(s.cards[0].clips === '6' && s.cards[1].clips === '3', 'H4 clip counts are per platform', s.cards.map(c => c.clips));
    ok(/Budget \$1,250\.00/.test(s.cards[0].budget) && /1\.8%/.test(s.cards[0].budget), 'H5 the Instagram card shows the budget, used campaign-wide (9 clips, not 6)', s.cards[0].budget);
    ok(s.cards[1].noBudget && /No separate budget/.test(s.cards[1].budget) && /billed with Vingo · Instagram/.test(s.cards[1].budget), 'H6 the YouTube card has no budget of its own', s.cards[1].budget);
    ok(/#8E1F17/.test(s.cards[1].banner) && /tint-youtube/.test(s.cards[1].bannerClass) && !s.cards[1].tinted, 'H7 the YouTube banner is red (flat, since this campaign has no banner image)', s.cards[1].banner);
    ok(!/tint-/.test(s.cards[0].bannerClass), 'H8 the Instagram banner is the campaign\'s own', s.cards[0].bannerClass);
    ok(s.cards[0].code === 'VI' && s.cards[1].code === 'VY', 'H9 badges tell the halves apart', s.cards.map(c => c.code));
    ok(/^2 campaigns running/.test(s.summary) && s.running === '2' && s.count === '2 campaigns', 'H10 the portfolio counts both halves', s.summary);
    ok(s.spend === '$22.50' && s.spendFoot === 'of $1,250.00 reserved budget', 'H11 spend is the whole campaign, the budget is counted once', [s.spend, s.spendFoot]);
    ok(!page.__errors.length, 'H12 no page errors', page.__errors);
    if (process.env.SHOT_DIR) {
      await page.evaluate(() => document.getElementById('camps').scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(400);
      await page.screenshot({ path: process.env.SHOT_DIR + '/split-home.png' });
    }
    /* open the YouTube half from its card */
    await page.click('#camps .camp[data-id="' + CAMP + ':youtube"] .camp-open');
    await page.waitForFunction(() => window.CLIPENCY_LIVE && window.CLIPENCY_LIVE.mode === 'live' && /campaign\.html/.test(location.pathname), null, { timeout: 15000 });
    await page.waitForTimeout(600);
    const c = await camp(page);
    ok(/VY/.test(c.chip) && /Vingo · YouTube/.test(c.chip), 'H13 the dashboard opens on the YouTube half', c.chip);
    ok(c.stBudget === '—' && c.stBudgetFoot === 'no separate budget · billed with Vingo · Instagram', 'H14 overview: no budget tile on the YouTube half', [c.stBudget, c.stBudgetFoot]);
    ok(c.stClips === '3' && c.stClipsFoot === 'on YouTube' && c.stSpend === '$7.50', 'H15 overview counts YouTube only', [c.stClips, c.stClipsFoot, c.stSpend]);
    if (process.env.SHOT_DIR) { await page.waitForTimeout(900); await page.screenshot({ path: process.env.SHOT_DIR + '/split-youtube-overview.png' }); }
    await ctx.close();
  }
  /* ---- YouTube half: clips, filters, review, rejected ---- */
  {
    const { ctx, page } = await open(browser, base, 'campaign.html', '?campaign=' + CAMP + ':youtube&view=clips');
    let c = await camp(page);
    ok(c.cards.length === 3 && c.cards.every(x => /@yt1|@both/.test(x)), 'Y1 clips feed: only YouTube clips', c.cards);
    ok(c.chips.join('|') === '*All platforms 3|YouTube 3', 'Y2 platform chips know only YouTube', c.chips);
    ok(c.creators.join(' / ') === 'All creators (2) / @yt1 · 2 clips / @both · 1 clip', 'Y3 creator list is YouTube creators with YouTube counts', c.creators);
    ok(c.badge === '1', 'Y4 review badge counts the YouTube clip waiting', c.badge);
    await page.click('#feedTabs .ft[data-tab="rejected"]'); await page.waitForTimeout(250);
    c = await camp(page);
    ok(c.rejected.length === 0, 'Y5 nothing rejected on YouTube', c.rejected);
    await page.goto(base + 'campaign.html?campaign=' + CAMP + ':youtube&view=review');
    await page.waitForFunction(() => window.CLIPENCY_LIVE && window.CLIPENCY_LIVE.mode === 'live', null, { timeout: 15000 }); await page.waitForTimeout(600);
    c = await camp(page);
    ok(c.pendingRows.length === 1 && /@newyt/.test(c.pendingRows[0]), 'Y6 review: only the YouTube clip waiting', c.pendingRows);
    ok(!page.__errors.length, 'Y7 no page errors', page.__errors);
    await ctx.close();
  }
  /* ---- Instagram half: nothing from YouTube, the budget read campaign-wide ---- */
  {
    const { ctx, page } = await open(browser, base, 'campaign.html', '?campaign=' + CAMP + ':instagram&view=clips');
    let c = await camp(page);
    ok(c.cards.length === 6 && c.cards.every(x => !/@yt1/.test(x)), 'I1 clips feed: only Instagram clips', c.cards);
    ok(c.chips.join('|') === '*All platforms 6|Instagram 6', 'I2 platform chips know only Instagram', c.chips);
    ok(c.creators.join(' / ') === 'All creators (3) / @ig1 · 3 clips / @both · 2 clips / @ig2 · 1 clip', 'I3 creator list is Instagram creators with Instagram counts', c.creators);
    ok(c.badge === '2', 'I4 review badge counts the Instagram clips waiting', c.badge);
    await page.click('#feedTabs .ft[data-tab="rejected"]'); await page.waitForTimeout(250);
    c = await camp(page);
    ok(c.rejected.length === 1 && /@ig2/.test(c.rejected[0]), 'I5 the rejected Instagram clip is here', c.rejected);
    await page.goto(base + 'campaign.html?campaign=' + CAMP + ':instagram&view=overview');
    await page.waitForFunction(() => window.CLIPENCY_LIVE && window.CLIPENCY_LIVE.mode === 'live', null, { timeout: 15000 }); await page.waitForTimeout(900);
    c = await camp(page);
    ok(c.stBudget === '1.8%' && c.stBudgetFoot === '$22.50 of $1,250.00 budget', 'I6 overview: the budget is read campaign-wide ($22.50, not $15.00)', [c.stBudget, c.stBudgetFoot]);
    ok(c.stClips === '6' && c.stClipsFoot === 'on Instagram' && c.stSpend === '$15.00', 'I7 overview counts Instagram only', [c.stClips, c.stClipsFoot, c.stSpend]);
    ok(/VI/.test(c.chip) && /Vingo · Instagram/.test(c.chip), 'I8 topbar names the half', c.chip);
    ok(!page.__errors.length, 'I9 no page errors', page.__errors);
    await ctx.close();
  }
  /* ---- a link with the bare campaign id (the review emails) ---- */
  {
    const { ctx, page } = await open(browser, base, 'campaign.html', '?campaign=' + CAMP + '&view=review');
    const c = await camp(page);
    ok(/Vingo · Instagram/.test(c.chip) && c.pendingRows.length === 2 && c.pendingRows.every(r => /@ig1/.test(r)), 'E1 a bare id opens the half that keeps the budget (clips wait on both)', [c.chip, c.pendingRows]);
    await ctx.close();
  }
  /* ---- budget page ---- */
  {
    const { ctx, page } = await open(browser, base, 'budget.html');
    const s = await page.evaluate(() => {
      const t = s => String(s || '').replace(/\s+/g, ' ').trim();
      return { rows: Array.from(document.querySelectorAll('#allocList .alloc-row')).map(r => t(r.textContent)), res: t(document.getElementById('sRes').textContent), spent: t(document.getElementById('sSpent').textContent) };
    });
    ok(s.rows.length === 2 && /Vingo · Instagram.*\$22\.50 of \$1,250\.00 · 1\.8% used/.test(s.rows[0]) && /Vingo · YouTube.*\$7\.50 spent · no separate budget · billed with Vingo · Instagram/.test(s.rows[1]),
       'B1 budget page: the shared budget read campaign-wide, the YouTube half reports its spend only', s.rows);
    ok(s.res === '$1,250.00' && s.spent === '$22.50', 'B2 reserved counts the budget once, spent is the whole', [s.res, s.spent]);
    await ctx.close();
  }
  /* ---- a budget per platform (campaigns.platform_budgets), each half at its own price ----
     Instagram $1,000 + YouTube $250 of the $1,250. YouTube is billed $1 a clip,
     Instagram $2.50: IG 6 clips = $15, YT 3 clips = $3. */
  {
    const pb = JSON.parse(JSON.stringify(PAYLOAD));
    pb.campaigns[0].platform_budgets = { instagram: 1000, youtube: 250 };
    pb.campaigns[0].client_platform_rates = { instagram: { rate_per_video: 2.5, rpm: 0 }, youtube: { rate_per_video: 1, rpm: 0 } };
    pb.submissions.forEach(s => { if (s.platform === 'YouTube') { s.earned = 1; s.earned_native = 1; } });
    const { ctx, page } = await open(browser, base, 'home.html', '', pb);
    const s = await home(page);
    const rpv = await page.evaluate(() => Array.from(document.querySelectorAll('#camps .camp')).map(c => c.querySelectorAll('.cn b')[2].textContent.trim()));
    ok(/Budget \$1,000\.00/.test(s.cards[0].budget) && /1\.5%/.test(s.cards[0].budget), 'P1 Instagram: its own budget, read against Instagram spend only ($15 of $1,000)', s.cards[0].budget);
    ok(!s.cards[1].noBudget && /Budget \$250\.00/.test(s.cards[1].budget) && /1\.2%/.test(s.cards[1].budget), 'P2 YouTube: a budget of its own ($3 of $250)', s.cards[1].budget);
    ok(rpv[0] === '$2.50' && rpv[1] === '$1.00', 'P3 each card shows the brand price on its own platform', rpv);
    ok(s.spend === '$18.00' && s.spendFoot === 'of $1,250.00 reserved budget', 'P4 the portfolio counts the whole budget once', [s.spend, s.spendFoot]);
    await page.click('#camps .camp[data-id="' + CAMP + ':youtube"] .camp-open');
    await page.waitForFunction(() => window.CLIPENCY_LIVE && window.CLIPENCY_LIVE.mode === 'live' && /campaign\.html/.test(location.pathname), null, { timeout: 15000 });
    await page.waitForTimeout(600);
    const c = await camp(page);
    const rateFoot = await page.evaluate(() => (document.getElementById('stSpendFoot') || {}).textContent);
    ok(c.stBudget === '1.2%' && c.stBudgetFoot === '$3.00 of $250.00 budget', 'P5 YouTube overview: its own budget tile', [c.stBudget, c.stBudgetFoot]);
    ok(c.stSpend === '$3.00' && rateFoot === 'at $1.00 per approved video', 'P6 YouTube overview: YouTube spend at the YouTube price', [c.stSpend, rateFoot]);
    /* Chrome reports an aborted view transition when the card navigates mid-animation: not the page's error */
    const perr = page.__errors.filter(m => !/Transition was aborted/.test(m));
    ok(!perr.length, 'P7 no page errors', perr);
    await ctx.close();
    const b2 = await open(browser, base, 'budget.html', '', pb);
    const bs = await b2.page.evaluate(() => {
      const t = s => String(s || '').replace(/\s+/g, ' ').trim();
      return { rows: Array.from(document.querySelectorAll('#allocList .alloc-row')).map(r => t(r.textContent)), res: t(document.getElementById('sRes').textContent) };
    });
    ok(bs.rows.length === 2 && /Vingo · Instagram.*\$15\.00 of \$1,000\.00 · 1\.5% used/.test(bs.rows[0]) && /Vingo · YouTube.*\$3\.00 of \$250\.00 · 1\.2% used/.test(bs.rows[1]) && bs.res === '$1,250.00',
       'P8 budget page: one row per platform budget, reserved is still the whole', bs);
    await b2.ctx.close();
  }
  /* ---- no clips yet: the empty campaign screen shows the right budget and rate ---- */
  {
    const e = JSON.parse(JSON.stringify(PAYLOAD));
    e.submissions = []; e.pending = [];
    e.campaigns[0].platform_budgets = { instagram: 1000, youtube: 250 };
    e.campaigns[0].client_platform_rates = { instagram: { rate_per_video: 2.5, rpm: 0 }, youtube: { rate_per_video: 1, rpm: 0 } };
    const { ctx, page } = await open(browser, base, 'campaign.html', '?campaign=' + CAMP + ':youtube', e);
    const meta = t(await page.evaluate(() => (document.querySelector('.empty-meta') || {}).textContent || ''));
    ok(/Budget reserved \$250\.00/.test(meta) && /RPV \$1\.00 \/ video/.test(meta) && !/1,000 views/.test(meta),
       'Z1 empty YouTube half: its own budget and its per-video price, never a per-1,000-views rate', meta);
    await ctx.close();
    const v = JSON.parse(JSON.stringify(e));
    Object.assign(v.campaigns[0], { payout_model: 'per_view', rate_per_video: 0, rate_per_video_native: 0, rpm: 1000, rpm_native: 1000,
      platform_split: null, platform_budgets: null, client_platform_rates: null });
    const r = await open(browser, base, 'campaign.html', '?campaign=' + CAMP, v);
    const meta2 = t(await r.page.evaluate(() => (document.querySelector('.empty-meta') || {}).textContent || ''));
    ok(/Rate \$1\.00 \/ 1,000 views/.test(meta2) && !/RPV/.test(meta2), 'Z2 a per-view campaign keeps its rate per 1,000 views', meta2);
    await r.ctx.close();
  }
  /* ---- not split: the same campaign without the flag is one card, as before ---- */
  {
    const plain = JSON.parse(JSON.stringify(PAYLOAD)); plain.campaigns[0].platform_split = null;
    const { ctx, page } = await open(browser, base, 'home.html', '', plain);
    const s = await home(page);
    ok(s.cards.length === 1 && s.cards[0].name === 'Vingo {UGC Campaign}' && /YouTube/.test(s.cards[0].plats) && /Instagram/.test(s.cards[0].plats) && s.cards[0].clips === '9' && /1\.8%/.test(s.cards[0].budget),
       'N1 without platform_split nothing changes', s.cards);
    await ctx.close();
  }

  await browser.close(); srv.close();
  console.log((fail ? 'FAILED ' : 'OK ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
