/* Client portal: email notification settings on Profile, and review-email
 * links (?campaign=<id>) opening the right campaign's Review section.
 *
 * Run:  PORTAL_DIR=/path/to/clipency-client-portal node tests/client-portal-email-prefs.browser.test.js
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

const CAMP2 = 'af4614c4-d16e-4ee5-8c15-efa1d24a7676';
const STUB = `
window.supabase = { createClient: function(){ return {
  auth: { getUser: async function(){ return {data:{user:{id:'client-1',email:'owner@brand.com'}}}; },
          getSession: async function(){ return {data:{session:{user:{id:'client-1'}}}}; },
          signOut: async function(){ return {}; },
          onAuthStateChange: function(){ return {data:{subscription:{unsubscribe:function(){}}}}; } },
  rpc: async function(name, args){
    (window.__RPC = window.__RPC || []).push({name:name, args:args});
    if (name === 'client_dashboard_data') return {data: window.__PAYLOAD, error: null};
    if (name === 'client_get_notify_prefs') {
      if (window.__MODE === 'load-error') return {data:null, error:{message:'boom'}};
      return {data: Object.assign({login_email:'owner@brand.com'}, window.__PREFS), error:null};
    }
    if (name === 'client_set_notify_prefs') {
      if (window.__MODE === 'save-error') return {data:null, error:{message:'enter a valid email address'}};
      window.__PREFS = { email_new_clips: args.p_new_clips, email_reminders: args.p_reminders, email_weekly: args.p_weekly,
        notify_email: args.p_email, timezone: args.p_timezone, saved: true };
      return {data: Object.assign({login_email:'owner@brand.com'}, window.__PREFS), error:null};
    }
    return {data:null, error:null};
  },
  from: function(){ var q = {select:function(){return q;}, eq:function(){return q;}, order:function(){return q;},
    in:function(){return q;}, limit:function(){return q;}, maybeSingle:async function(){return {data:null,error:null};},
    then:function(r){ return Promise.resolve({data:[],error:null}).then(r); }}; return q; }
}; } };`;

async function open(browser, base, pageName, p, prefs, mode, tz) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, timezoneId: tz || 'Asia/Kolkata' });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (/supabase-js@2/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    return route.abort();
  });
  await ctx.addInitScript(({ p, prefs, m }) => {
    try { localStorage.setItem('sb-spwtkdgpgeutrhwcjrpy-auth-token', '{"fake":1}'); localStorage.setItem('clipency-tour-seen', '1'); } catch (e) {}
    window.__PAYLOAD = p; window.__PREFS = prefs; window.__MODE = m;
  }, { p, prefs, m: mode || 'ok' });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await page.goto(base + pageName);
  await page.waitForFunction(() => window.CLIPENCY_LIVE && window.CLIPENCY_LIVE.mode === 'live', null, { timeout: 15000 });
  await page.waitForTimeout(700);
  return { ctx, page };
}
const prefsState = page => page.evaluate(() => { const q = id => document.getElementById(id); return {
  newOn: q('ntNew').checked, remOn: q('ntRem').checked, weekOn: q('ntWeek').checked, email: q('ntEmail').value, ph: q('ntEmail').placeholder,
  hint: q('ntEmailHint').textContent, tz: q('ntTz').value, tzs: Array.from(q('ntTz').options).map(o => o.value),
  err: q('ntErr').textContent, state: q('ntState').textContent, toast: (q('toastMsg') || q('cxToastMsg') || {}).textContent || document.body.innerText.match(/Email settings saved\./) ? 'saved' : '',
  sets: (window.__RPC || []).filter(x => x.name === 'client_set_notify_prefs').map(x => x.args),
  visible: !!q('ntPanel').getClientRects().length }; });

(async () => {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const P = () => payload(JSON.parse(JSON.stringify(SUBS)), JSON.parse(JSON.stringify(PEND)));

  /* 1. first visit: defaults on, login email, detected timezone */
  {
    const { ctx, page } = await open(browser, base, 'profile.html', P(),
      { email_new_clips: true, email_reminders: true, notify_email: null, timezone: 'Asia/Kolkata', saved: false }, 'ok', 'America/New_York');
    let s = await prefsState(page);
    ok(s.visible && s.newOn && s.remOn && s.weekOn && s.email === '' && s.ph === 'owner@brand.com' && /owner@brand\.com/.test(s.hint), 'N1 defaults: on, login email', s);
    ok(s.tz === 'America/New_York' && s.tzs.indexOf('Asia/Kolkata') > -1, 'N2 timezone from the browser on first visit', s);
    ok(/Emails go to owner@brand\.com/.test(s.state), 'N3 says where emails go', s.state);
    // turn the daily summary off, send elsewhere, save: both old switches go off together
    await page.click('#ntNew');
    await page.fill('#ntEmail', 'team@brand.com');
    await page.click('#ntSave');
    await page.waitForTimeout(300);
    s = await prefsState(page);
    ok(s.sets.length === 1 && s.sets[0].p_new_clips === false && s.sets[0].p_reminders === false &&
       s.sets[0].p_weekly === true && s.sets[0].p_email === 'team@brand.com' && s.sets[0].p_timezone === 'America/New_York', 'N4 save sends the choices', s.sets);
    ok(!s.newOn && !s.remOn && s.email === 'team@brand.com' && /Emails go to team@brand\.com/.test(s.state) && s.err === '', 'N5 saved state shown', s);
    // bad email is caught before the network
    await page.fill('#ntEmail', 'nope');
    await page.click('#ntSave');
    await page.waitForTimeout(200);
    s = await prefsState(page);
    ok(s.sets.length === 1 && /valid email/.test(s.err), 'N6 invalid email is refused on the page', s);
    // all off
    await page.fill('#ntEmail', '');
    await page.click('#ntWeek');
    await page.click('#ntSave');
    await page.waitForTimeout(300);
    s = await prefsState(page);
    ok(s.sets.length === 2 && s.sets[1].p_new_clips === false && s.sets[1].p_reminders === false && s.sets[1].p_weekly === false &&
       s.sets[1].p_email === null && /All emails are off/.test(s.state) && !s.weekOn, 'N7 all off, empty email means login email', s);
    ok(!page.__errors.length, 'N8 no page errors', page.__errors);
    await ctx.close();
  }

  /* 2. saved settings load back */
  {
    const { ctx, page } = await open(browser, base, 'profile.html', P(),
      { email_new_clips: false, email_reminders: true, email_weekly: false, notify_email: 'ops@brand.com', timezone: 'Europe/London', saved: true });
    const s = await prefsState(page);
    ok(s.newOn && s.remOn && !s.weekOn && s.email === 'ops@brand.com' && s.tz === 'Europe/London', 'N9 saved settings shown: reminders on still means the daily summary is on', s);
    const labels = await page.evaluate(() => document.getElementById('ntPanel').innerText);
    ok(/Daily review summary/.test(labels) && /One email a day/.test(labels) && !/10, 20, 30|Reminder before|6 hours/.test(labels)
       && /Weekly report/.test(labels) && /Every Monday/.test(labels), 'N9b labels describe the daily summary and weekly, nothing old', labels);
    const visibleRem = await page.evaluate(() => !!document.getElementById('ntRem').getClientRects().length);
    ok(!visibleRem, 'N9c the old reminder switch is not shown', visibleRem);
    await page.click('#ntSave');
    await page.waitForTimeout(300);
    const s2 = await prefsState(page);
    ok(s2.sets.length === 1 && s2.sets[0].p_new_clips === true && s2.sets[0].p_reminders === true, 'N9d saving keeps both old switches in step', s2.sets);
    await ctx.close();
  }

  /* 3. server errors are shown, not swallowed */
  for (const mode of ['load-error', 'save-error']) {
    const { ctx, page } = await open(browser, base, 'profile.html', P(),
      { email_new_clips: true, email_reminders: true, notify_email: null, timezone: 'Asia/Kolkata', saved: true }, mode);
    if (mode === 'save-error') { await page.click('#ntSave'); await page.waitForTimeout(300); }
    const s = await prefsState(page);
    ok(mode === 'load-error' ? /Could not load/.test(s.err) : /valid email/.test(s.err), 'N10 [' + mode + '] error shown', s.err);
    ok(!page.__errors.length, 'N11 [' + mode + '] no page errors', page.__errors);
    await ctx.close();
  }

  /* 4. the email link opens the named campaign's Review */
  {
    const two = P();
    two.campaigns.push(Object.assign({}, two.campaigns[0], { id: CAMP2, title: "Tal's Pod", created_at: '2026-09-20T00:00:00Z' }));
    two.pending.push({ id: '00000000-0000-4000-8000-999999999999', campaign_id: CAMP2, campaign_title: "Tal's Pod", platform: 'YouTube',
      handle: '@talclips', clip_url: 'https://youtube.com/shorts/abcdefgh', created_at: new Date().toISOString(),
      review_due_at: new Date(Date.now() + 40 * 3600e3).toISOString(), auto_approve_paused: false });
    for (const [id, want, n] of [[CAMP2, '@talclips', 1], [CAMP, '@gamma', 3]]) {
      const { ctx, page } = await open(browser, base, 'campaign.html?view=review&campaign=' + id, two, {});
      const s = await page.evaluate(() => ({ view: CX.current, active: CLIPDB.active().id,
        rows: Array.from(document.querySelectorAll('#aprList .apr-row')).map(r => r.querySelector('.c').textContent) }));
      ok(s.view === 'review' && s.active === id && s.rows.length === n && s.rows.some(t => t.indexOf(want) > -1), 'N12 link opens ' + id.slice(0, 4) + ' Review', s);
      ok(!page.__errors.length, 'N13 no page errors', page.__errors);
      await ctx.close();
    }
    // a campaign id the client cannot see falls back quietly
    const { ctx, page } = await open(browser, base, 'campaign.html?view=review&campaign=11111111-1111-4111-8111-111111111111', two, {});
    const s = await page.evaluate(() => ({ view: CX.current, active: CLIPDB.active().id }));
    ok(s.view === 'review' && (s.active === CAMP || s.active === CAMP2), 'N14 unknown campaign id falls back to a real one', s);
    await ctx.close();
  }

  await browser.close(); srv.close();
  console.log((fail ? 'FAILED ' : 'OK ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
