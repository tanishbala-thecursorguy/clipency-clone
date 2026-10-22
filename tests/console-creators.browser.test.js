/* Admin console: Creators section. Browse (all / by campaign / new sign-ups),
 * profile, connect an account straight into a campaign with or without the
 * application, bulk submit, applications.
 *
 * Run:  CONSOLE_DIR=/path/to/repo-root node tests/console-creators.browser.test.js
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
      const f = path.join(DIR, u);
      if (!f.startsWith(DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'content-type': /\.html$/.test(f) ? 'text/html' : 'application/javascript' });
      fs.createReadStream(f).pipe(rsp);
    }).listen(0, () => res(srv));
  });
}

const U = 'u-1111', NEWU = 'u-new1';
const TAL = 'c-tal', VINGO = 'c-vingo', NOREV = 'c-norev', IGONLY = 'c-igonly';
const OV = {
  creators: 120, with_accounts: 40, new_7d: 6, new_30d: 30, never_joined: 70, active_30d: 12,
  platforms: { instagram: 31, youtube: 9, tiktok: 4 }, pending_accounts: 0, pending_applications: 3,
  campaigns: [
    { id: VINGO, title: 'Vingo {UGC Campaign}', status: 'active', is_private: true },
    { id: TAL, title: "Tal's Pod [Podcast]", status: 'active', is_private: false },
    { id: 'c-old', title: 'WoT Heat', status: 'paused', is_private: false }
  ]
};
const ROW = (i, extra) => Object.assign({ id: 'u-' + i, email: 'c' + i + '@x.com', name: 'Creator ' + i, created_at: '2026-09-' + String(10 + (i % 18)).padStart(2, '0') + 'T00:00:00Z',
  ig: 1, yt: 0, tt: 0, verified: 1, accounts_pending: 0, clips: 3, approved: 2, pending: 1, views: 12000, last_clip_at: '2026-10-01T00:00:00Z', campaigns: 1 }, extra || {});
const DETAIL = {
  profile: { id: U, email: 'mercy@gmail.com', name: 'Mercy L', role: 'clipper', created_at: '2026-08-01T00:00:00Z' },
  accounts: [
    { id: 'a-ig', platform: 'instagram', handle: 'mercyunnfiltered', status: 'verified', verified_at: '2026-08-02T00:00:00Z', clips: 4, by_admin: false, shared: 2 },
    { id: 'a-tt', platform: 'tiktok', handle: 'mercytok', status: 'rejected', created_at: '2026-08-03T00:00:00Z', clips: 0, by_admin: false }
  ],
  applications: [
    { id: 'ap-1', campaign_id: VINGO, campaign_title: 'Vingo {UGC Campaign}', account_id: 'a-ig', account_handle: 'mercyunnfiltered',
      account_platform: 'instagram', status: 'pending', note: 'pls', created_at: '2026-09-30T00:00:00Z' }
  ],
  joined: [{ campaign_id: VINGO, title: 'Vingo {UGC Campaign}', status: 'active', is_private: true, clips: 28, approved: 18, pending: 2,
             views: 95889, accounts: ['instagram @mercyunnfiltered'], access: 'pending' }],
  clips: [
    { id: 's-1', campaign_title: "Tal's Pod", platform: 'Instagram', handle: 'mercyunnfiltered', clip_url: 'https://www.instagram.com/reel/AAA/',
      status: 'pending', review_due_at: '2026-10-08T00:00:00Z', views: 0, created_at: '2026-10-05T00:00:00Z' }
  ],
  campaigns: [
    { id: TAL, title: "Tal's Pod [Podcast]", brand: "Tal's Pod", platform: 'YouTube,Instagram,TikTok', is_private: false, client_review: true },
    { id: VINGO, title: 'Vingo {UGC Campaign}', brand: 'Vingo', platform: 'Youtube,instagram', is_private: true, client_review: true },
    { id: NOREV, title: 'Open Call', brand: 'Open', platform: null, is_private: false, client_review: false },
    { id: IGONLY, title: 'Reels Only', brand: 'R', platform: 'Instagram', is_private: false, client_review: true }
  ]
};

function stub(role) {
  return `
(function(){
  var OV = ${JSON.stringify(OV)}, D = ${JSON.stringify(DETAIL)}, ROLE = ${JSON.stringify(role)};
  var ROW = ${ROW.toString()};
  window.__RPC = [];
  function q(table){
    var b = { select:function(){return b;}, order:function(){return b;}, limit:function(){return b;}, range:function(){return b;},
      gte:function(){return b;}, lte:function(){return b;}, neq:function(){return b;}, not:function(){return b;}, is:function(){return b;},
      or:function(){return b;}, ilike:function(){return b;}, in:function(){return b;}, eq:function(){return b;},
      maybeSingle:function(){return b;}, single:function(){return b;},
      then:function(res,rej){ return Promise.resolve({data:[],error:null,count:0}).then(res,rej); } };
    return b;
  }
  function list(a){
    var view = a.p_view || 'all', off = a.p_offset || 0, lim = a.p_limit || 50;
    if (view === 'campaign') {
      var rows = [
        ROW(1, {id:'${U}', name:'Mercy L', email:'mercy@gmail.com', campaign_accounts:[
          {account_id:'a-ig', platform:'instagram', handle:'mercyunnfiltered', account_status:'verified', app_id:'ap-1', access:'pending', clips:28, approved:18, pending:2, views:95889}]}),
        ROW(2, {campaign_accounts:[{account_id:'a-2', platform:'youtube', handle:'two', account_status:'verified', app_id:'ap-2', access:'approved', clips:5, approved:5, pending:0, views:100}]})
      ];
      if (a.p_access === 'approved') rows = rows.slice(1);
      return {total: rows.length, limit: lim, offset: off, campaign: {id:a.p_campaign, title:'Vingo {UGC Campaign}', status:'active', is_private: a.p_campaign === '${VINGO}',
        platform:'Youtube,instagram', client_review:true, creators: rows.length, clips: 33, approved: 23, pending: 2, views: 95989, applications_pending: 1}, rows: rows};
    }
    if (view === 'new') {
      var total = a.p_days == null ? 70 : 6;
      var rr = []; for (var i = 0; i < Math.min(lim, total - off); i++) rr.push(ROW(500 + off + i, {id: i === 0 && off === 0 ? '${NEWU}' : 'n' + (off + i), clips:0, approved:0, pending:0, views:0, last_clip_at:null, campaigns:0, ig:0, verified:0, accounts_pending: i === 1 ? 1 : 0}));
      return {total: total, limit: lim, offset: off, campaign: null, rows: rr};
    }
    var t = a.p_q ? 1 : a.p_platform ? 9 : a.p_segment === 'no_accounts' ? 80 : 120;
    var r2 = []; for (var j = 0; j < Math.min(lim, t - off); j++) r2.push(ROW(off + j, j === 0 && off === 0 ? {id:'${U}', name:'Mercy L', email:'mercy@gmail.com'} : null));
    return {total: t, limit: lim, offset: off, campaign: null, rows: r2};
  }
  window.supabase = { createClient: function(){ return {
    auth: { getUser: async function(){ return {data:{user:{id:'admin-1', email:'a@x.com', user_metadata:{full_name:'Admin'}}}}; },
            getSession: async function(){ return {data:{session:{user:{id:'admin-1'}}}}; },
            onAuthStateChange: function(){ return {data:{subscription:{unsubscribe:function(){}}}}; } },
    from: q,
    rpc: async function(name, a){
      window.__RPC.push({name:name, args:a});
      if (name === 'admin_access_check') return {data:{role:ROLE}, error:null};
      if (name === 'admin_creators_overview') return {data: JSON.parse(JSON.stringify(OV)), error:null};
      if (name === 'admin_list_creators') { if (window.__SLOW) await new Promise(function(r){ setTimeout(r, window.__SLOW); }); return {data: list(a || {}), error:null}; }
      if (name === 'admin_creator_detail') return {data: JSON.parse(JSON.stringify(D)), error:null};
      if (name === 'admin_connect_account') {
        if (/taken/.test(a.p_handle)) return {data:null, error:{message:'@taken on youtube is already connected to another creator (x@y.com).'}};
        var h = String(a.p_handle).replace(/^@/, '');
        D.accounts.push({id:'a-new', platform:a.p_platform, handle:h, status:'verified', verified_at:'2026-10-06T00:00:00Z', clips:0, by_admin:true});
        var acc = !a.p_campaign ? null : a.p_campaign === '${VINGO}' ? (a.p_bypass ? 'approved' : 'pending') : 'open';
        if (acc === 'approved' || acc === 'pending') D.applications.push({id:'ap-n', campaign_id:a.p_campaign, campaign_title:'Vingo', account_id:'a-new', account_handle:h, account_platform:a.p_platform, status:acc, created_at:'2026-10-06T00:00:00Z'});
        return {data:{id:'a-new', platform:a.p_platform, handle:h, result:'added', campaign_id:a.p_campaign, access:acc}, error:null};
      }
      if (name === 'admin_grant_campaign_access') {
        D.applications.push({id:'ap-g', campaign_id:a.p_campaign, campaign_title:'granted', account_id:a.p_account, account_handle:'x', account_platform:'youtube', status:'approved', created_at:'2026-10-06T00:00:00Z'});
        return {data:{id:'ap-g', status:'approved'}, error:null};
      }
      if (name === 'admin_bulk_submit_clips') {
        var res = a.p_urls.map(function(u, i){ return /bad/.test(u) ? {url:u, ok:false, error:'Not a link to a single post.'} : {url:u, ok:true, id:'n'+i}; });
        var okn = res.filter(function(x){return x.ok;}).length;
        return {data:{submitted:okn, failed:res.length-okn, client_review:true, results:res}, error:null};
      }
      if (name === 'admin_review_application') {
        D.applications.forEach(function(x){ if (x.id === a.p_id) { x.status = a.p_approve ? 'approved' : 'rejected'; x.rejection_reason = a.p_reason || null; } });
        return {data:null, error:null};
      }
      return {data: [], error: null};
    },
    storage: { from: function(){ return {}; } },
    functions: { invoke: async function(){ return {data:null, error:null}; } },
    channel: function(){ var c = {on:function(){return c;}, subscribe:function(){return c;}}; return c; },
    removeChannel: function(){}
  }; } };
})();`;
}
async function boot(browser, base, role, hash) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (/supabase-js@2/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: stub(role) });
    return route.abort();
  });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  page.on('dialog', d => d.dismiss());
  await page.goto(base + 'console.html' + (hash || '#creators'));
  return { ctx, page };
}
const rpcs = (page, n) => page.evaluate(n => window.__RPC.filter(r => r.name === n), n);
const lastList = async page => (await rpcs(page, 'admin_list_creators')).pop().args;
const txt = (page, s) => page.$eval(s, e => e.textContent).catch(() => '');
const hash = page => page.evaluate(() => location.hash);

(async () => {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  let { ctx, page } = await boot(browser, base, 'admin');
  await page.waitForSelector('table.cr-tbl', { timeout: 15000 });

  /* ---- all creators ---- */
  const nav = await page.$$eval('#nav a', as => as.map(a => a.dataset.id));
  ok(nav.indexOf('creators') > -1, 'B1a Creators in the admin sidebar');
  const kp = await page.$$eval('.kpi', ks => ks.map(k => k.textContent.replace(/\s+/g, ' ').trim()));
  ok(/Creators\s*120/.test(kp[0]) && /New this week\s*6/.test(kp[1]) && /Never joined a campaign\s*70/.test(kp[2]) && /Active in 30 days\s*12/.test(kp[3]),
     'B1b KPIs come from the overview', kp);
  ok(/Instagram 31 · YouTube 9 · TikTok 4/.test(await page.textContent('#view')), 'B1c verified accounts per platform');
  const tabs = await page.$$eval('.cr-seg a', as => as.map(a => a.textContent.trim()));
  ok(tabs.length === 3 && /All creators/.test(tabs[0]) && /By campaign/.test(tabs[1]) && /New sign-ups/.test(tabs[2]), 'B1d three screens as tabs', tabs);
  ok((await page.$$('table.cr-tbl tbody tr')).length === 50 && /1–50 of 120/.test(await page.textContent('#view')), 'B1e first 50 of 120 with a pager');
  ok(!/Find a creator/.test(await page.textContent('#view')), 'B1f no separate search box');
  let a = await lastList(page);
  ok(a.p_view === 'all' && a.p_offset === 0 && a.p_sort === 'newest', 'B1g lists every creator, newest first', a);

  await page.click('#crNext');
  await page.waitForFunction(() => /51–100 of 120/.test(document.getElementById('view').textContent));
  ok((await lastList(page)).p_offset === 50, 'B2a Next asks for the next 50');
  await page.click('#crPrev');
  await page.waitForFunction(() => /1–50 of 120/.test(document.getElementById('view').textContent));
  ok((await lastList(page)).p_offset === 0, 'B2b Prev goes back');
  await page.click('#crNext');
  await page.waitForFunction(() => /51–100 of 120/.test(document.getElementById('view').textContent));
  await page.selectOption('#crSort', 'oldest');
  await page.waitForFunction(() => /1–50 of 120/.test(document.getElementById('view').textContent));
  a = await lastList(page);
  ok(a.p_offset === 0 && a.p_sort === 'oldest', 'B2c changing a filter goes back to page 1', a);
  await page.selectOption('#crSort', 'newest');
  await page.waitForTimeout(300);

  const before = (await rpcs(page, 'admin_list_creators')).length;
  await page.fill('#crQ', 'm');
  await page.waitForTimeout(450);
  ok((await rpcs(page, 'admin_list_creators')).length === before, 'B3a one letter does not filter');
  await page.fill('#crQ', 'mercy');
  await page.waitForFunction(() => /1 creator\b/.test(document.getElementById('view').textContent));
  ok((await lastList(page)).p_q === 'mercy', 'B3b text filter sent');
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'crQ'), 'B3c focus stays in the filter');
  /* keep typing while the first filter is still loading: nothing typed is lost */
  await page.fill('#crQ', '');
  await page.waitForFunction(() => /of 120/.test(document.getElementById('view').textContent));
  await page.evaluate(() => { window.__SLOW = 500; });
  await page.click('#crQ');
  await page.keyboard.type('mer', { delay: 30 });
  await page.waitForTimeout(450);              /* debounce fired, request in flight, screen dimmed */
  ok(await page.evaluate(() => document.getElementById('view').classList.contains('is-loading') && !!document.getElementById('crQ')),
     'B3h filter box stays on screen while loading');
  await page.keyboard.type('cy', { delay: 30 });
  await page.waitForTimeout(1800);
  await page.evaluate(() => { window.__SLOW = 0; });
  ok(await page.$eval('#crQ', e => e.value) === 'mercy' && (await lastList(page)).p_q === 'mercy',
     'B3i letters typed during a load are kept and searched', [await page.$eval('#crQ', e => e.value), (await lastList(page)).p_q]);
  /* change two filters back to back: the second must not be dropped while the first loads */
  await page.evaluate(() => { window.__SLOW = 400;
    const p = document.getElementById('crPlatF'); p.value = 'youtube'; p.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(150);   /* first list request is in flight */
  await page.evaluate(() => {
    const s = document.getElementById('crSeg'); if (s) { s.value = 'no_accounts'; s.dispatchEvent(new Event('change')); }
  });
  await page.waitForTimeout(1300);
  await page.evaluate(() => { window.__SLOW = 0; });
  a = await lastList(page);
  ok(a.p_platform === 'youtube' && a.p_segment === 'no_accounts' && await page.$eval('#crSeg', s => s.value) === 'no_accounts',
     'B3g two quick filter changes both apply, nothing dropped', a);
  await page.selectOption('#crPlatF', '');
  await page.waitForTimeout(300);
  await page.selectOption('#crSeg', 'all');
  await page.waitForTimeout(300);
  await page.fill('#crQ', '');
  await page.waitForFunction(() => /of 120/.test(document.getElementById('view').textContent));
  await page.selectOption('#crPlatF', 'youtube');
  await page.waitForFunction(() => /9 creators/.test(document.getElementById('view').textContent));
  ok((await lastList(page)).p_platform === 'youtube', 'B3d platform filter sent');
  await page.selectOption('#crPlatF', '');
  await page.waitForSelector('#crSeg');
  await page.selectOption('#crSeg', 'no_accounts');
  await page.waitForFunction(() => /of 80/.test(document.getElementById('view').textContent));
  ok((await lastList(page)).p_segment === 'no_accounts', 'B3e segment filter sent');
  await page.selectOption('#crSort', 'views');
  await page.waitForTimeout(300);
  a = await lastList(page);
  ok(a.p_sort === 'views' && a.p_segment === 'no_accounts' && a.p_offset === 0, 'B3f sort keeps the other filters', a);
  await page.selectOption('#crSeg', 'all');
  await page.waitForFunction(() => /of 120/.test(document.getElementById('view').textContent));

  /* ---- open a profile from the list ---- */
  const listHash = await hash(page);
  await page.click(`tr[data-crrow="${U}"] td:nth-child(3)`);
  await page.waitForSelector('#crHandle');
  ok((await hash(page)) === '#creators?u=' + U, 'B4a clicking a row opens their profile on its own URL', await hash(page));
  ok(await page.$eval('#crBack', e => e.getAttribute('href')) === listHash, 'B4b back goes to the list they came from');
  const body = await page.textContent('#view');
  ok(/Mercy L/.test(body) && /mercy@gmail\.com/.test(body) && /@mercyunnfiltered/.test(body), 'B4c profile shows the creator and accounts');
  ok(/Campaigns/.test(body) && /instagram @mercyunnfiltered/.test(body) && /18 approved · 2 pending/.test(body), 'B4d campaigns they are in, with the accounts used');
  ok(/with brand/.test(body), 'B4e pending clip in client review reads "with brand"');
  ok(/also on 2 other creators/.test(body), 'B4f a handle verified on other creators is flagged');

  /* ---- connect into a campaign ---- */
  ok(!(await page.$('#crBypass')), 'B5a no bypass box without a campaign');
  await page.selectOption('#crLinkCamp', VINGO);
  await page.waitForSelector('#crBypass');
  ok(await page.$eval('#crBypass', e => e.checked), 'B5b private campaign: skip application is on by default');
  await page.selectOption('#crPlat', 'youtube');
  await page.fill('#crHandle', '@taken');
  await page.click('#crAdd');
  await page.waitForFunction(() => /already connected/.test(document.getElementById('crAddMsg').textContent));
  ok(true, 'B5c connect error shown');
  await page.fill('#crHandle', '@NewTube');
  await page.click('#crAdd');
  await page.waitForFunction(() => /YouTube\s*1/.test(document.querySelectorAll('.kpi')[1].textContent));
  let c = (await rpcs(page, 'admin_connect_account')).pop().args;
  ok(c.p_user === U && c.p_platform === 'youtube' && c.p_handle === '@NewTube' && c.p_campaign === VINGO && c.p_bypass === true, 'B5d connect into Vingo with the application bypassed', c);
  ok(await page.$eval('#crAcct', s => s.value) === 'a-new' && await page.$eval('#crCamp', s => s.value) === VINGO, 'B5e bulk submit now set to that account and campaign');

  await page.selectOption('#crLinkCamp', VINGO);
  await page.waitForSelector('#crBypass');
  await page.uncheck('#crBypass');
  await page.selectOption('#crPlat', 'instagram');
  await page.fill('#crHandle', 'second.ig');
  await page.click('#crAdd');
  await page.waitForTimeout(500);
  c = (await rpcs(page, 'admin_connect_account')).pop().args;
  ok(c.p_campaign === VINGO && c.p_bypass === false, 'B5f unticked sends it as a pending application', c);
  await page.selectOption('#crLinkCamp', TAL);
  await page.waitForTimeout(200);
  ok(!(await page.$('#crBypass')) && /is public, so the account can submit straight away/.test(await page.textContent('#view')), 'B5g public campaign: no bypass needed');
  await page.selectOption('#crLinkCamp', '');

  /* ---- bulk ---- */
  await page.selectOption('#crCamp', TAL);
  ok(/Tal's Pod’s Review to approve or reject/.test(await txt(page, '#crWhere')), 'B6a says the brand reviews them');
  await page.fill('#crUrls', 'https://youtube.com/shorts/aaa1\nhttps://bad.link\n\nhttps://youtu.be/bbb2');
  ok(/Submit 3 clips/.test(await txt(page, '#crSend')), 'B6b counts links');
  await page.click('#crSend');
  await page.waitForFunction(() => /2 submitted, 1 refused/.test(document.getElementById('view').textContent));
  const bs = (await rpcs(page, 'admin_bulk_submit_clips')).pop().args;
  ok(bs.p_user === U && bs.p_campaign === TAL && bs.p_urls.length === 3, 'B6c bulk args', bs);
  ok(await page.$eval('#crUrls', t => t.value) === 'https://bad.link', 'B6d refused link stays');
  const nb = (await rpcs(page, 'admin_bulk_submit_clips')).length;
  await page.fill('#crUrls', Array.from({ length: 101 }, (_, i) => 'https://youtu.be/x' + i).join('\n'));
  await page.click('#crSend');
  await page.waitForFunction(() => /Up to 100/.test(document.getElementById('crSendMsg').textContent));
  ok((await rpcs(page, 'admin_bulk_submit_clips')).length === nb, 'B6e 101 refused before any call');
  await page.selectOption('#crCamp', IGONLY);
  ok(/does not take YouTube clips/.test(await page.textContent('#view')), 'B6f wrong platform flagged');

  /* ---- applications on the profile ---- */
  await page.click('[data-crapno="ap-1"]');
  await page.click('#crRejGo');
  ok(/needs a reason/.test(await txt(page, '#crRejMsg')), 'B7a reject needs a reason');
  await page.fill('#crRej', 'Account too new');
  await page.click('#crRejGo');
  await page.waitForFunction(() => !document.querySelector('[data-crapno="ap-1"]'));
  const rv = (await rpcs(page, 'admin_review_application')).pop().args;
  ok(rv.p_id === 'ap-1' && rv.p_approve === false && rv.p_reason === 'Account too new', 'B7b reject sends the reason', rv);

  /* ---- back keeps the list filters ---- */
  await page.click('#crBack');
  await page.waitForSelector('table.cr-tbl');
  a = await lastList(page);
  ok(a.p_view === 'all' && a.p_sort === 'views', 'B8 back to the list with its filters kept', a);
  ok(page.__errors.length === 0, 'B9 no page errors', page.__errors);
  await ctx.close();

  /* ---- new sign-ups feed ---- */
  ({ ctx, page } = await boot(browser, base, 'admin'));
  await page.waitForSelector('table.cr-tbl', { timeout: 15000 });
  await page.click('a.kpi[href="#creators?view=new"]');
  await page.waitForFunction(() => /New sign-ups/.test(document.querySelector('.card h2') && document.querySelector('.card h2').textContent));
  ok((await hash(page)) === '#creators?view=new', 'N1a New this week opens its own screen', await hash(page));
  a = await lastList(page);
  ok(a.p_view === 'new' && a.p_days === 7, 'N1b last 7 days by default', a);
  ok(/6 creators/.test(await page.textContent('#view')) && /1 waiting for verification/.test(await page.textContent('#view')), 'N1c count and pending accounts shown');
  await page.selectOption('#crDays', 'any');
  await page.waitForFunction(() => /of 70/.test(document.getElementById('view').textContent));
  ok((await hash(page)) === '#creators?view=new&days=any' && (await lastList(page)).p_days === null, 'N2 any time lists every never-joined creator');
  await page.click(`a.btn[href="#creators?u=${NEWU}"]`);
  await page.waitForSelector('#crHandle');
  ok(await page.$eval('#crBack', e => e.getAttribute('href')) === '#creators?view=new&days=any', 'N3 profile back link returns to the feed');
  ok(page.__errors.length === 0, 'N4 no page errors', page.__errors);
  await ctx.close();

  /* ---- by campaign ---- */
  ({ ctx, page } = await boot(browser, base, 'admin', '#creators?view=campaign'));
  await page.waitForSelector('#crCampPick', { timeout: 15000 });
  ok(!(await page.$('table.cr-tbl')) && (await page.$$('a.btn[href^="#creators?view=campaign&c="]')).length === 3, 'C1 pick a campaign first, every campaign offered');
  await page.selectOption('#crCampPick', VINGO);
  await page.waitForSelector('table.cr-tbl');
  ok((await hash(page)) === '#creators?view=campaign&c=' + VINGO, 'C2a campaign is in the URL');
  a = await lastList(page);
  ok(a.p_view === 'campaign' && a.p_campaign === VINGO, 'C2b asks for that campaign', a);
  const cb = await page.textContent('#view');
  ok(/Creators in it\s*2/.test(cb) && /Waiting for access\s*1/.test(cb) && /@mercyunnfiltered/.test(cb) && /28 clips/.test(cb), 'C2c campaign stats and each creator\'s accounts in it');
  ok(await page.$('#crAccess') !== null, 'C2d private campaign has an access filter');
  await page.click('[data-crapok="ap-1"]');
  await page.waitForTimeout(400);
  const apv = (await rpcs(page, 'admin_review_application')).pop().args;
  ok(apv.p_id === 'ap-1' && apv.p_approve === true, 'C3 approve (bypass) straight from the campaign list', apv);
  ok((await hash(page)).indexOf('u=') === -1, 'C3b approving does not open the profile');
  await page.selectOption('#crAccess', 'approved');
  await page.waitForTimeout(400);
  ok((await lastList(page)).p_access === 'approved', 'C4 access filter sent');
  await page.click(`tr[data-crrow="u-2"] td:nth-child(3)`);
  await page.waitForSelector('#crHandle');
  ok(await page.$eval('#crBack', e => e.getAttribute('href')) === '#creators?view=campaign&c=' + VINGO, 'C5 profile back link returns to the campaign');
  ok(page.__errors.length === 0, 'C6 no page errors', page.__errors);
  ok(!/creator rate|rate_per_video|budget_used/i.test(await page.textContent('#view')), 'C7 no money on the Creators pages');
  await ctx.close();

  /* ---- reviewers do not get this page ---- */
  ({ ctx, page } = await boot(browser, base, 'reviewer', '#creators'));
  await page.waitForSelector('#nav a', { timeout: 15000 });
  await page.waitForTimeout(600);
  const rnav = await page.$$eval('#nav a', as => as.map(a => a.dataset.id));
  ok(rnav.indexOf('creators') === -1 && !(await page.$('table.cr-tbl')), 'R1 reviewers do not see Creators', rnav);
  ok((await rpcs(page, 'admin_creators_overview')).length === 0, 'R2 and nothing is fetched for them');
  await ctx.close();

  await browser.close(); srv.close();
  console.log(`console-creators: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
