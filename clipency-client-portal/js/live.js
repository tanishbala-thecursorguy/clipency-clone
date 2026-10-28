/* ============================================================
   CLIPENCY CLIENT PORTAL — live data layer (READ ONLY)
   ------------------------------------------------------------
   Loads the signed-in client's real campaigns and clips and
   swaps them into window.CLIPENCY *in place*, so every helper
   in data.js and every page that calls them keeps working with
   no change to the markup, the CSS, or any page script.

   Why "in place": data.js closes over `var S = C.submissions`.
   Reassigning CLIPENCY.submissions would leave every helper
   pointing at the old array. We mutate instead.

   ------------------------------------------------------------
   WHAT CHANGED, AND WHY IT MATTERS

   The previous version read `clip_submissions` directly with the
   anon key and `persistSession:false` — no user session at all.
   Three consequences, every one of which forced a hardcoded value:

     1. No auth.uid(), so the portal could not tell which client
        was looking. The campaign had to be pinned in config.js,
        so one deployment served exactly one client.
     2. `campaigns` is readable by `authenticated` only, so the
        anon key got [] back and the title, budget and rate had to
        be typed into config.js by hand.
     3. READ_ONLY blocked rpc() outright, so client_dashboard_data()
        — the function that answers all of this properly — could
        not even be called.

   Now: we use the client's own session, call client_dashboard_data(),
   and read the campaign and the money straight out of the result.
   config.js no longer contains anything client-specific.

   ------------------------------------------------------------
   MONEY: WHICH COLUMNS ARE ACTUALLY POPULATED

   Verified in production 3 Aug 2026. `budget_usd` and
   `rate_per_million_usd` are 0.00 on every row — they were never
   backfilled. The live values are:

       campaigns.budget  = 400        total budget, dollars
       campaigns.rpm     = 1000.00    dollars per MILLION views

   so $ per 1,000 views = rpm / 1000 = $1.00. Reading rpm first and
   falling back to rate_per_million_usd (rather than the reverse) is
   the whole reason the rate no longer has to be hardcoded.
   ============================================================ */
/* ============================================================
   CXCUR - display currency for the client portal
   ------------------------------------------------------------
   Every campaign is priced in its own currency (Rs 250 per video, or
   $2.50 per video). Money reaches the portal twice: native, in the
   campaign's currency, and USD, at the campaign's own fx rate.

   Two ways to look at it:
     DEFAULT  each campaign in its own currency. A figure that adds
              campaigns together (wallet, portfolio) can only be stated
              in one currency: the shared one when every campaign agrees,
              otherwise USD, because a total that adds rupees to dollars
              is not a number.
     <code>   everything converted to that currency. A campaign's own
              currency is always shown exactly (never round-tripped);
              anything else goes native -> USD at the campaign's fx rate
              (the rate its clips are stamped at) -> target at the day's
              rate from cx_fx_rates.

   Display only. Billing, budgets and payouts never read this.
   ============================================================ */
window.CXCUR = (function () {
  'use strict';
  var LIST = [
    { c: 'USD', s: '$',      loc: 'en-US', dp: 2, name: 'US dollar' },
    { c: 'INR', s: '₹', loc: 'en-IN', dp: 2, name: 'Indian rupee' },
    { c: 'EUR', s: '€', loc: 'en-IE', dp: 2, name: 'Euro' },
    { c: 'GBP', s: '£', loc: 'en-GB', dp: 2, name: 'British pound' },
    { c: 'AUD', s: 'A$',     loc: 'en-AU', dp: 2, name: 'Australian dollar' },
    { c: 'CAD', s: 'C$',     loc: 'en-CA', dp: 2, name: 'Canadian dollar' },
    { c: 'JPY', s: '¥', loc: 'ja-JP', dp: 0, name: 'Japanese yen' }
  ];
  /* Floor for a payload that carries no rates (older rpc, demo). The
     payload's own rates replace these on every load. */
  var FALLBACK = { USD: 1, INR: 95.82, EUR: 0.87032, GBP: 0.74656,
                   AUD: 1.401, CAD: 1.4004, JPY: 157.27 };
  var rates = {}, asOf = null, source = 'fallback';
  Object.keys(FALLBACK).forEach(function (k) { rates[k] = FALLBACK[k]; });

  var KEY = 'cx-client-curr-v1';
  function up(c) { return String(c || '').trim().toUpperCase(); }
  function info(code) {
    var k = up(code);
    for (var i = 0; i < LIST.length; i++) if (LIST[i].c === k) return LIST[i];
    return null;
  }
  function valid(m) { return m === 'DEFAULT' || !!info(m); }
  var mode = 'DEFAULT';
  try { var saved = up(localStorage.getItem(KEY)); if (valid(saved)) mode = saved; } catch (e) {}

  function setRates(fx) {
    if (!fx || !fx.rates) return false;
    var hit = 0;
    LIST.forEach(function (cu) {
      var r = Number(fx.rates[cu.c]);
      if (isFinite(r) && r > 0) { rates[cu.c] = r; hit++; }
    });
    if (hit) { asOf = fx.as_of || null; source = 'server'; }
    return hit > 0;
  }
  function rate(code) { var k = up(code) || 'USD'; return rates[k] || FALLBACK[k] || 1; }

  /* amount in `from` -> `to`. fxFrom: the campaign's own units per USD,
     so a native figure becomes the same USD the server stamps. */
  function conv(n, from, to, fxFrom) {
    n = Number(n) || 0; from = up(from) || 'USD'; to = up(to) || 'USD';
    if (from === to) return n;
    var usd = from === 'USD' ? n : n / ((Number(fxFrom) > 0 && from !== 'USD') ? Number(fxFrom) : rate(from));
    return to === 'USD' ? usd : usd * rate(to);
  }

  function fmt(n, code) {
    var cu = info(code) || LIST[0];
    var v = Number(n);
    if (!isFinite(v)) v = 0;
    var neg = v < 0 && Math.abs(v) >= Math.pow(10, -cu.dp) / 2;
    var body = Math.abs(v).toLocaleString(cu.loc,
      { minimumFractionDigits: cu.dp, maximumFractionDigits: cu.dp });
    return (neg ? '-' : '') + cu.s + body;
  }

  /* The currency one campaign's figures are shown in. */
  function target(ccy) { return mode === 'DEFAULT' ? (info(ccy) ? up(ccy) : 'USD') : mode; }
  /* The currency a total across several campaigns is shown in. */
  function targetForSet(ccys) {
    if (mode !== 'DEFAULT') return mode;
    var seen = {};
    (ccys || []).forEach(function (c) { if (info(c)) seen[up(c)] = 1; });
    var k = Object.keys(seen);
    return k.length === 1 ? k[0] : 'USD';
  }

  function set(m) {
    m = up(m);
    if (!valid(m)) return false;
    mode = m;
    try { localStorage.setItem(KEY, m); } catch (e) {}
    return true;
  }

  return {
    LIST: LIST, info: info, fmt: fmt, conv: conv, rate: rate,
    target: target, targetForSet: targetForSet, set: set, setRates: setRates,
    symbol: function (code) { return (info(code) || LIST[0]).s; },
    get mode() { return mode; },
    get asOf() { return asOf; },
    get source() { return source; }
  };
})();

(function () {
  'use strict';

  var CFG = window.CLIPENCY_CONFIG || {};
  var LOG = [];

  function note(level, msg, extra) {
    LOG.push({ level: level, msg: msg, extra: extra, t: new Date().toISOString() });
    var f = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    try {
      if (extra !== undefined) console[f]('[clipency:live] ' + msg, extra);
      else console[f]('[clipency:live] ' + msg);
    } catch (e) { /* console shape varies */ }
  }

  window.CLIPENCY_LIVE = {
    mode: 'loading',      // 'live' | 'empty' | 'signed-out' | 'error' | 'loading'
    log: LOG,
    campaigns: [],
    ready: null
  };

  /* ---------------------------------------------------------
     1. Read-only guard

     Mutations are blocked. rpc() is deliberately NOT blocked: the
     dashboard is delivered by an rpc, and every rpc this portal
     calls is a SECURITY DEFINER read already scoped to auth.uid().
     --------------------------------------------------------- */
  var MUTATORS = ['insert', 'update', 'upsert', 'delete'];

  function guardClient(sb) {
    if (!CFG.READ_ONLY) return sb;
    var realFrom = sb.from.bind(sb);
    sb.from = function (table) {
      var qb = realFrom(table);
      MUTATORS.forEach(function (m) {
        qb[m] = function () {
          var e = new Error(
            'READ_ONLY: blocked ' + m + '() on "' + table + '". ' +
            'The client portal is a reporting surface and does not write.'
          );
          note('error', e.message);
          throw e;
        };
      });
      return qb;
    };
    return sb;
  }

  /* ---------------------------------------------------------
     2. Presentation helpers for fields the rpc does not carry
     --------------------------------------------------------- */
  function youtubeId(url) {
    if (!url) return null;
    var m = String(url).match(
      /(?:youtube\.com\/(?:shorts\/|watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/
    );
    return m ? m[1] : null;
  }

  /* Every Instagram clip fell through to null here, and the pages drop the
     value straight into src="", so the portal showed a broken-image icon on
     most of the grid and an empty box in the flag dialog. Instagram gives no
     public thumbnail to link to, so the honest answer is a placeholder that
     looks deliberate: a neutral card, inline, no request to make. */
  var NO_COVER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 180">' +
    '<rect width="120" height="180" fill="#E9E4DC"/>' +
    '<circle cx="60" cy="90" r="21" fill="none" stroke="#BCB2A4" stroke-width="2"/>' +
    '<path d="M54 80l16 10-16 10z" fill="#BCB2A4"/></svg>');

  /* Clip fields come from creators, and the portal pages build their HTML with
     innerHTML. Clean them here, once, so nothing a creator types can become markup:
     links must be real http(s) URLs, handles keep only handle characters, and text
     loses the characters that could open a tag or close an attribute. */
  function safeUrl(u) {
    try {
      var x = new URL(String(u || '').trim());
      if (x.protocol !== 'https:' && x.protocol !== 'http:') return '';
      return x.href.replace(/'/g, '%27').replace(/"/g, '%22').replace(/</g, '%3C').replace(/>/g, '%3E');
    } catch (e) { return ''; }
  }
  function safeText(t) {
    return String(t == null ? '' : t).replace(/[<>"`]/g, '').replace(/'/g, '\u2019');
  }

  function coverFor(row) {
    if (row.cover_url) return safeUrl(row.cover_url) || NO_COVER;
    var yid = youtubeId(row.clip_url);
    return yid ? 'https://i.ytimg.com/vi/' + yid + '/hqdefault.jpg' : NO_COVER;
  }

  function cleanHandle(h) {
    if (!h) return '@unknown';
    var s = String(h).trim();
    if (/^https?:\/\//i.test(s)) {                 // some handles are full URLs
      var parts = s.replace(/\/+$/, '').split('/');
      s = parts[parts.length - 1] || 'unknown';
    }
    s = s.replace(/^@+/, '').replace(/[^\w.\-]/g, '');
    return s ? '@' + s : '@unknown';
  }

  /* Clip titles are not stored anywhere. The cards show a title, so
     fall back to something readable instead of blank tiles. */
  function titleFor(r) {
    if (r.title) return safeText(r.title);
    var h = cleanHandle(r.handle);
    return h === '@unknown' ? (safeText(r.campaign_title) || 'Clip') : h + ' clip';
  }

  /* ---------------------------------------------------------
     3. Commercial terms, per campaign
     --------------------------------------------------------- */
  function cpmOf(camp) {                 // dollars per 1,000 views
    if (!camp) return 0;
    var perMillion = Number(camp.rpm) || Number(camp.rate_per_million_usd) || 0;
    return perMillion / 1000;
  }

  function budgetOf(camp) {
    if (!camp) return 0;
    return Number(camp.budget) || Number(camp.budget_usd) || 0;
  }

  /* ---- currency ----
     See CXCUR at the top of this file. Each row and each campaign keeps its
     native figure and currency; what is shown is derived from those. */
  function ccyOf(camp) {
    var k = String((camp && camp.currency) || 'USD').toUpperCase();
    return window.CXCUR.info(k) ? k : 'USD';
  }
  function fxOf(camp) {
    var f = Number(camp && camp.fx_rate_per_usd);
    return f > 0 ? f : window.CXCUR.rate(ccyOf(camp));
  }

  /* Platform fee. client_dashboard_data() now sends platform_fee and
     creator_pool already computed, but fall back to the raw columns so this
     still works against an older payload. The fee is INCLUSIVE: a $400
     campaign at 20% leaves $320 for clippers. */
  function feeOf(camp) {
    if (!camp) return 0;
    if (camp.platform_fee != null) return Number(camp.platform_fee) || 0;
    if (camp.platform_fee_amount != null) return Number(camp.platform_fee_amount) || 0;
    return Math.round(budgetOf(camp) * (Number(camp.platform_fee_percent) || 0) / 100 * 100) / 100;
  }

  function poolOf(camp) {
    if (!camp) return 0;
    if (camp.creator_pool != null) return Number(camp.creator_pool) || 0;
    return Math.max(Math.round((budgetOf(camp) - feeOf(camp)) * 100) / 100, 0);
  }

  /* ---------------------------------------------------------
     4. Map the rpc payload into the shape data.js expects
     --------------------------------------------------------- */
  function mapRow(r, campById) {
    var camp = campById[String(r.campaign_id)];
    var views = Number(r.views || r.views_count || 0);
    var rowCcy = String(r.currency || ccyOf(camp)).toUpperCase();
    if (!window.CXCUR.info(rowCcy)) rowCcy = 'USD';
    var rowFx = Number(r.fx_rate_per_usd) > 0 ? Number(r.fx_rate_per_usd) : fxOf(camp);
    /* earned_native first. An older payload without it: rebuild native
       from USD at the campaign's rate; with neither, price the views. */
    var amountNative = (r.earned_native != null) ? Number(r.earned_native)
      : (r.earned != null) ? Number(r.earned) * rowFx
      : views / 1000 * cpmOf(camp) * rowFx;          // cpmOf reads the USD rpm
    amountNative = Math.round(amountNative * 100) / 100;
    return {
      id: r.id,
      title: titleFor(r),
      creator: cleanHandle(r.handle),
      platform: String(r.platform || '').toLowerCase(),   // DB stores "Instagram"
      status: r.status || 'approved',
      views: views,
      likes: Number(r.likes || 0),
      comments: Number(r.comments || 0),
      submitted: String(r.created_at || '').slice(0, 10),
      url: safeUrl(r.clip_url),
      cover: coverFor(r),
      campaignId: r.campaign_id,
      campaignTitle: safeText(r.campaign_title || (camp && camp.title) || ''),
      /* Flag state, so the portal can show what has been pulled, who pulled it
         and what Clipency decided. A campaign can be shared, so the client
         looking at this may not be the one who raised it. */
      flaggedAt: r.flagged_at || null,
      flag: r.flag || null,
      /* Who decided a clip that did not go through Clipency: the client
         (approved or rejected on the Awaiting approval tab) or 'auto' (the
         review window ran out). Null for a Clipency decision. */
      review: r.review || null,
      /* Per-clip cost to the client. The server already computes this —
         client_dashboard_data() sends `earned` at the rate the client is
         billed, per clip, at that clip's own campaign rate.

         This used to ignore it and recompute views/1000 * cpm. On a
         per-video campaign there is no cpm (rpm is zeroed on save), so
         every clip came back at $0 and the whole portal told the client
         they had spent nothing on a campaign that was billing them.
         Views cannot price a per-video campaign; only the server figure
         can. Fall back to the derivation only when the payload has no
         `earned` — an older rpc, or a demo row. */
      /* Client-billed figure for this clip, in the campaign's own
         currency (earned_native) and in USD at the campaign's fx rate
         (earned). `amount` is what the screen shows: native in DEFAULT
         view, converted when a currency is picked. */
      ccy: rowCcy,
      fx: rowFx,
      amountNative: amountNative,
      amountUsd: (r.earned != null) ? Math.round(Number(r.earned) * 100) / 100 : null,
      amount: window.CXCUR.conv(amountNative, rowCcy, window.CXCUR.target(rowCcy), rowFx)
    };
  }

  /* A submission waiting for the client's approval. No money on it: the
     server sends none, and the clip is not billed until it is approved. */
  function mapPending(r) {
    return {
      id: r.id,
      title: titleFor(r),
      creator: cleanHandle(r.handle),
      platform: String(r.platform || '').toLowerCase(),
      url: r.clip_url,
      cover: coverFor(r),
      campaignId: r.campaign_id,
      campaignTitle: r.campaign_title || '',
      submitted: String(r.created_at || '').slice(0, 10),
      submittedAt: r.created_at || null,
      dueAt: r.review_due_at || null,
      paused: !!r.auto_approve_paused
    };
  }

  /* ---------------------------------------------------------
     5. Swap into CLIPENCY (in place)
     --------------------------------------------------------- */
  function applyLive(payload) {
    var C = window.CLIPENCY;
    var camps = payload.campaigns || [];
    var rows  = payload.submissions || [];

    var campById = {};
    camps.forEach(function (c) { campById[String(c.id)] = c; });

    /* the day's rates, before any figure is converted */
    window.CXCUR.setRates(payload.fx);
    var ccy = window.CXCUR.targetForSet(camps.map(ccyOf));

    var mapped = rows.map(function (r) { return mapRow(r, campById); });

    /* submissions: mutate, never reassign */
    C.submissions.length = 0;
    mapped.forEach(function (r) { C.submissions.push(r); });

    /* Master copy. CLIPDB.applyActive() narrows C.submissions to one
       campaign; without an untouched list to filter from, switching
       campaigns would permanently discard the others. */
    C.__allSubmissions = mapped.slice();

    /* Awaiting the client's approval. Same in-place rule, same master copy
       for CLIPDB.applyActive() to narrow per campaign. */
    var pend = (payload.pending || []).map(mapPending);
    if (!Array.isArray(C.pending)) C.pending = [];
    C.pending.length = 0;
    pend.forEach(function (r) { C.pending.push(r); });
    C.__allPending = pend.slice();

    /* Campaign meta. With several campaigns the portal represents the
       client as a whole: budgets add up, and the headline rate is the
       one from their newest campaign (the rpc orders created_at desc). */
    var primary = camps[0] || null;
    var earliest = mapped.reduce(function (a, r) {
      return (r.submitted && (!a || r.submitted < a)) ? r.submitted : a;
    }, null);

    C.campaign.client = camps.length > 1
      ? (camps.length + ' campaigns')
      : ((primary && primary.title) || 'Your campaigns');
    /* Word initials, not the first two letters: "Northwind Podcast" was
       rendering as the badge "NO". */
    C.campaign.code = (function (t) {
      var w = String(t || '').replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).filter(Boolean);
      if (!w.length) return 'CX';
      if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
      return (w[0][0] + w[1][0]).toUpperCase();
    })((primary && primary.title) || '');
    C.campaign.label = 'Live client portal · powered by Clipency';
    C.campaign.start = earliest ||
      String((primary && primary.start_date) || (primary && primary.created_at) || '').slice(0, 10) ||
      C.campaign.start;
    C.campaign.end = (primary && primary.end_date) || null;
    C.campaign.status = (primary && primary.status) || 'active';
    /* Until CLIPDB.applyActive() narrows to one campaign: the set's
       currency, with budget and rate restated in it. */
    C.campaign.currency = ccy;
    C.campaign.currencySymbol = window.CXCUR.symbol(ccy);
    C.campaign.budget = camps.reduce(function (a, c) {
      var n = c.budget_native != null ? Number(c.budget_native) : budgetOf(c) * fxOf(c);
      return a + window.CXCUR.conv(n, ccyOf(c), ccy, fxOf(c));
    }, 0);
    C.campaign.cpm = primary ? window.CXCUR.conv(
      (primary.rpm_native != null ? Number(primary.rpm_native) : Number(primary.rpm || 0) * fxOf(primary)) / 1000,
      ccyOf(primary), ccy, fxOf(primary)) : 0;
    C.campaigns = camps;

    patchHelpers(C);

    /* A campaign whose first clips are still awaiting approval is live:
       the client has something to do. */
    window.CLIPENCY_LIVE.mode = (mapped.length || pend.length) ? 'live' : 'empty';
    window.CLIPENCY_LIVE.campaigns = camps;
    window.CLIPENCY_LIVE.wallet = payload.wallet || { balance: 0, ledger: [] };
    window.CLIPENCY_LIVE.totals = payload.totals || null;

    /* db.js holds the wallet/campaign/profile store the Budget, Profile
       and Home pages read. It seeds empty and is filled from here, so it
       can never show one client's figures to another. */
    try{
      if(window.CLIPDB && window.CLIPDB.syncFromLive){
        window.CLIPDB.syncFromLive();
        if(window.CLIPDB.applyActive) window.CLIPDB.applyActive();
      }
    }catch(e){ note('warn','CLIPDB sync failed: ' + e.message); }
    note('info', 'live: ' + mapped.length + ' clips across ' + camps.length + ' campaign(s)');
  }

  /* Corrections the mock helpers need once they meet real data.

     - spend: sum per-clip amounts, so mixed rates total correctly
     - guard divide-by-zero for a client with no clips yet
     - daily(): the mock pinned "today" to 2026-07-20, which silently
       truncated every chart at that date                            */
  function patchHelpers(C) {
    if (C.__livePatched) return;
    C.__livePatched = true;

    /* Every figure in the portal goes through this, and it was hardcoded to
       a dollar sign, so a rupee campaign quoted rupee amounts with a $ in
       front of them. */
    C.money = function (n) {
      return window.CXCUR.fmt(n, C.campaign.currency || 'USD');
    };

    var realTotals = C.totals;
    C.totals = function () {
      if (!C.submissions.length) {
        return {
          approvedViews: 0, allViews: 0, approvedCount: 0, allCount: 0,
          rejectedCount: 0, pendingCount: 0, likes: 0, comments: 0,
          spend: 0, budget: C.campaign.budget, budgetSpend: 0, budgetUsed: 0, approvalRate: 0
        };
      }
      var t = realTotals.call(C);
      /* The payload also carries flagged and rejected clips (for the
         Rejected tab); engagement counts live clips only. */
      t.likes = C.approved().reduce(function (a, r) { return a + (r.likes || 0); }, 0);
      t.comments = C.approved().reduce(function (a, r) { return a + (r.comments || 0); }, 0);
      var summed = C.approved().reduce(function (a, r) { return a + (r.amount || 0); }, 0);
      t.spend = Math.round(summed * 100) / 100;
      /* One half of a split campaign shares the budget with the others
         (db.js), so what is read against it is campaign-wide. */
      var forBudget = (C.campaign.budgetSpend != null) ? C.campaign.budgetSpend : summed;
      t.budgetSpend = Math.round(forBudget * 100) / 100;
      t.budgetUsed = C.campaign.budget
        ? Math.round(forBudget / C.campaign.budget * 1000) / 10
        : 0;
      return t;
    };

    C.daily = function () {
      /* Views AND money per day. The money half is why this exists: the
         weekly spend bars on Billing and on the campaign page sum d.spend,
         and this override used to return {date, views, cum} only. Summing a
         key that was never set gave every chart a max of 0, so every bar
         drew at zero height and a client who had really been billed saw an
         empty chart. The mock daily() in data.js always carried spend, so
         the demo looked right and only real accounts were affected.

         Summed from each clip's own priced amount, never derived from views:
         that is the only figure correct under both payout models, and on a
         per-video campaign views price nothing at all. */
      var map = {}, smap = {};
      C.approved().forEach(function (r) {
        if (!r.submitted) return;
        map[r.submitted] = (map[r.submitted] || 0) + (r.views || 0);
        smap[r.submitted] = (smap[r.submitted] || 0) + (r.amount || 0);
      });
      var keys = Object.keys(map).sort();
      if (!keys.length) return [];

      var start = (C.campaign.start && C.campaign.start < keys[0]) ? C.campaign.start : keys[0];
      var last = keys[keys.length - 1];
      var today = new Date().toISOString().slice(0, 10);
      if (last < today) last = today;          // extend to now, never truncate

      var days = [], cum = 0, cums = 0, d = new Date(start + 'T00:00:00Z'), guard = 0;
      while (guard++ < 2000) {
        var k = d.toISOString().slice(0, 10);
        cum += (map[k] || 0);
        cums += (smap[k] || 0);
        days.push({ date: k, views: map[k] || 0, cum: cum,
                    spend: Math.round((smap[k] || 0) * 100) / 100,
                    cumSpend: Math.round(cums * 100) / 100 });
        if (k >= last) break;
        d.setUTCDate(d.getUTCDate() + 1);
      }
      return days;
    };

    var realByCreator = C.byCreator;
    C.byCreator = function () {
      var out = realByCreator.call(C);
      var byCreator = {};
      C.approved().forEach(function (r) {
        byCreator[r.creator] = (byCreator[r.creator] || 0) + (r.amount || 0);
      });
      out.forEach(function (m) {
        m.spend = Math.round((byCreator[m.creator] || 0) * 100) / 100;
      });
      return out;
    };
  }

  /* An empty client is a legitimate state, not a failure: a client
     whose campaign has not started should see zeroes. The old build
     fell back to the mock array here, so a brand-new client's portal
     showed 48 clips belonging to nobody. */
  function applyEmpty(reason) {
    var C = window.CLIPENCY;
    C.submissions.length = 0;
    if (Array.isArray(C.pending)) C.pending.length = 0;
    C.__allPending = [];
    C.campaign.client = 'Your campaigns';
    C.campaign.budget = 0;
    C.campaign.cpm = 0;
    C.campaigns = [];
    patchHelpers(C);
    try{ if(window.CLIPDB && window.CLIPDB.syncFromLive) window.CLIPDB.syncFromLive(); }catch(e){}
    window.CLIPENCY_LIVE.reason = reason;
    if (window.CLIPENCY_LIVE.mode !== 'error') window.CLIPENCY_LIVE.mode = 'empty';
    note('warn', 'no data to show — ' + reason);
  }

  /* ---------------------------------------------------------
     5b. Demo mode

     A prospect with no account opens /home?demo=1 and gets the real
     portal — the same nine pages, the same charts — running on the
     sample campaign in data.js. Nothing here touches Supabase, so a
     demo visitor cannot read a single row of client data.

     data.js is finally doing the job its header describes: it is the
     shape definition and the demo fixture, and live data overwrites it
     for everyone who is actually signed in.
     --------------------------------------------------------- */
  function isDemo() {
    try {
      if (/[?&]demo=1/.test(location.search)) return true;
      return sessionStorage.getItem('clipency-demo') === '1';
    } catch (e) { return false; }
  }

  function applyDemo() {
    var C = window.CLIPENCY;

    /* The mock rows carry no campaign id or per-clip amount — live rows
       get both from the rpc. Synthesise them so every downstream helper,
       and CLIPDB, behaves exactly as it does on real data. */
    var cpm = Number(C.campaign.cpm) || 1;
    var campId = 'demo-campaign';
    C.submissions.forEach(function (r) {
      r.campaignId = campId;
      r.campaignTitle = C.campaign.client;
      if (r.amountNative === undefined) {
        r.amountNative = (r.amount !== undefined) ? r.amount
          : Math.round((r.views || 0) / 1000 * cpm * 100) / 100;
      }
      /* The sample campaign is priced in dollars; a picked currency
         converts it like any other. */
      r.ccy = 'USD'; r.fx = 1; r.amountUsd = r.amountNative;
      r.amount = window.CXCUR.conv(r.amountNative, 'USD', window.CXCUR.target('USD'), 1);
    });
    C.__allSubmissions = C.submissions.slice();

    var demoCamp = {
      id: campId,
      title: C.campaign.client || 'Sample campaign',
      brand_name: C.campaign.client || 'Sample',
      status: 'active',
      currency: 'USD',
      fx_rate_per_usd: 1,
      budget: Number(C.campaign.budget) || 0,
      budget_native: Number(C.campaign.budget) || 0,
      rpm: cpm * 1000,                       // helper reads rpm as per-million
      rpm_native: cpm * 1000,
      platform: 'Instagram,YouTube',
      category: 'Podcast',
      description: 'Sample campaign data. Nothing here is a real client.',
      created_at: C.campaign.start,
      start_date: C.campaign.start,
      end_date: null
    };

    window.CLIPENCY_LIVE.mode = 'demo';
    window.CLIPENCY_LIVE.campaigns = [demoCamp];
    window.CLIPENCY_LIVE.email = 'demo@clipency.in';

    patchHelpers(C);
    try {
      if (window.CLIPDB && window.CLIPDB.syncFromLive) {
        window.CLIPDB.syncFromLive();
        if (window.CLIPDB.applyActive) window.CLIPDB.applyActive();
      }
    } catch (e) { note('warn', 'CLIPDB demo sync failed: ' + e.message); }

    note('info', 'demo mode: ' + C.submissions.length + ' sample clips, no network call');
  }

  /* ---------------------------------------------------------
     6. Client + session
     --------------------------------------------------------- */
  function makeClient() {
    var sb = guardClient(
      window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
        /* persistSession MUST be true. The dashboard is scoped by
           auth.uid(); without the stored session every rpc runs as
           anon and raises "not authenticated". */
        auth: { persistSession: true, autoRefreshToken: true }
      })
    );
    window.clipencySupabase = sb;
    window.supabaseClient = sb;
    window.sbClient = sb;
    return sb;
  }

  function toSignin() {
    window.CLIPENCY_LIVE.mode = 'signed-out';
    var url = CFG.SIGNIN_URL || './client-signin.html';
    note('warn', 'no session — redirecting to ' + url);
    try { location.replace(url); } catch (e) { /* non-browser */ }
  }

  /* ---------------------------------------------------------
     7. Session cache
     --------------------------------------------------------- */
  var CACHE_KEY = 'clipency-live-v2';   // v2: payload shape changed

  function ttlMs() { return (Number(CFG.CACHE_TTL_SECONDS) || 90) * 1000; }

  function readCache(uid) {
    if (CFG.DISABLE_CACHE) return null;
    try {
      var o = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (!o || o.uid !== uid) return null;   // never serve one client's rows to another
      var age = Date.now() - o.t;
      if (age > ttlMs()) return null;
      o.ageMs = age;
      return o;
    } catch (e) { return null; }
  }

  function writeCache(uid, payload) {
    if (CFG.DISABLE_CACHE) return;
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({
        t: Date.now(), uid: uid, payload: payload
      }));
    } catch (e) { note('warn', 'could not write cache: ' + e.message); }
  }

  /* ---------------------------------------------------------
     8. Boot
     --------------------------------------------------------- */
  async function boot() {
    if (!window.CLIPENCY) { note('error', 'data.js did not load'); return; }

    /* Demo first: no session check, no client, no query. */
    if (isDemo()) { applyDemo(); return; }

    if (!window.supabase || !window.supabase.createClient) {
      window.CLIPENCY_LIVE.mode = 'error';
      applyEmpty('the Supabase library did not load (network or content blocker)');
      return;
    }
    if (!CFG.SUPABASE_URL || /PASTE_/.test(CFG.SUPABASE_ANON_KEY || '')) {
      window.CLIPENCY_LIVE.mode = 'error';
      applyEmpty('config.js is not filled in');
      return;
    }

    var sb = makeClient();

    var uid = null;
    try {
      var u = await sb.auth.getUser();
      uid = (u && u.data && u.data.user) ? u.data.user.id : null;
      window.CLIPENCY_LIVE.email = (u && u.data && u.data.user) ? u.data.user.email : null;
    } catch (e) { uid = null; }

    if (!uid) { toSignin(); return; }

    var cached = readCache(uid);
    if (cached) {
      try {
        applyLive(cached.payload);
        note('info', 'served from cache (' + Math.round(cached.ageMs / 1000) + 's old)');
        revalidateInBackground(sb, uid);
        return;
      } catch (e) {
        note('warn', 'cache replay failed, falling through: ' + e.message);
      }
    }

    try {
      var res = await sb.rpc('client_dashboard_data');
      if (res.error) throw res.error;
      var payload = res.data || {};
      applyLive(payload);
      writeCache(uid, payload);
    } catch (err) {
      var msg = (err && err.message) || String(err);
      window.CLIPENCY_LIVE.mode = 'error';
      window.CLIPENCY_LIVE.reason = msg;
      note('error', 'live load failed', err);

      /* "not a client account" means the person IS signed in, just not as
         a client — typically a clipper reusing their own credentials here.
         This used to render the empty shell, which let them sit inside the
         portal looking at a broken dashboard.

         Now: destroy the session and send them back. That cannot loop,
         because the sign-in page runs the same check before it forwards
         anyone, so they can never obtain a portal session in the first
         place. Without the signOut it WOULD loop, since the page gate only
         looks for a token. */
      if (/not a client account/i.test(msg)) {
        note('warn', 'signed in, but not a client account — signing out');
        applyEmpty('this login is not a client account');
        (async function () {
          try { await sb.auth.signOut(); } catch (e) { /* clear it anyway */ }
          try {
            localStorage.removeItem('sb-' + (CFG.SUPABASE_URL || '')
              .replace('https://', '').split('.')[0] + '-auth-token');
          } catch (e) {}
          try { sessionStorage.removeItem(CACHE_KEY); } catch (e) {}
          var u = CFG.SIGNIN_URL || './client-signin.html';
          try { location.replace(u + (u.indexOf('?') > -1 ? '&' : '?') + 'notclient=1'); } catch (e) {}
        })();
      } else if (/not authenticated|JWT|session/i.test(msg)) {
        toSignin();
      } else {
        applyEmpty(msg);
      }
    }
  }

  /* Stale-while-revalidate: the page has already painted from cache,
     so refresh quietly and only re-render if something actually moved. */
  function revalidateInBackground(sb, uid) {
    setTimeout(async function () {
      try {
        var res = await sb.rpc('client_dashboard_data');
        if (res.error) return;
        var payload = res.data || {};
        var before = sessionStorage.getItem(CACHE_KEY);
        writeCache(uid, payload);

        var changed = true;
        try {
          var prev = (JSON.parse(before || '{}').payload || {}).submissions || [];
          var now = payload.submissions || [];
          /* Status too: a clip flagged or resolved elsewhere keeps the same
             count and views, and used to leave a stale card on screen. */
          changed = prev.length !== now.length || sumViews(prev) !== sumViews(now) ||
                    statusSig(prev) !== statusSig(now) ||
                    pendingSig(JSON.parse(before || '{}').payload) !== pendingSig(payload);
        } catch (e) { /* treat as changed */ }

        if (changed) {
          note('info', 'background refresh found new data — re-rendering');
          applyLive(payload);
          document.dispatchEvent(new CustomEvent('clipency:data-ready', {
            detail: { mode: window.CLIPENCY_LIVE.mode, refreshed: true }
          }));
        }
      } catch (e) {
        note('warn', 'background refresh failed (page already rendered)');
      }
    }, 400);
  }

  function statusSig(rows) {
    return rows.map(function (r) {
      return r.id + ':' + r.status + ':' + ((r.flag && r.flag.resolution) || '');
    }).sort().join('|');
  }

  function pendingSig(p) {
    return ((p && p.pending) || []).map(function (r) { return r.id; }).sort().join('|');
  }

  function sumViews(rows) {
    return rows.reduce(function (a, r) {
      return a + Number(r.views || r.views_count || 0);
    }, 0);
  }

  /* ---------------------------------------------------------
     9. Mode banner
     --------------------------------------------------------- */
  function banner() {
    if (!CFG.SHOW_MODE_BANNER) return;
    var m = window.CLIPENCY_LIVE.mode;
    if (m === 'signed-out') return;

    var live = m === 'live';
    var demo = m === 'demo';
    var text = live ? 'Live data · read-only'
      : demo ? 'Sample data · this is a demo, not a real campaign'
      : m === 'empty' ? 'No clips to show yet'
      : 'Could not load your data · see console';

    /* The demo bar used to carry "Request access" and "Exit demo" links.
       Both are gone: the guided tour is now the whole demo, it cannot be
       skipped, and it ends on the request-access form by itself. Leaving
       those links here would be two ways to walk out of a tour that is
       supposed to be unskippable. What remains is a label, and it is
       explicitly not clickable. */
    if (demo) {
      var bar = document.createElement('div');
      bar.setAttribute('data-clipency-mode', 'demo');
      bar.style.cssText = [
        'position:fixed','left:0','right:0','bottom:0','z-index:9997',
        'text-align:center','padding:8px 16px','pointer-events:none',
        'font:500 11px/1.6 Inter,system-ui,sans-serif','letter-spacing:.06em',
        'text-transform:uppercase','backdrop-filter:blur(8px)',
        'background:rgba(11,11,11,.92)','color:#C9A227',
        'border-top:1px solid rgba(201,162,39,.35)'
      ].join(';');
      bar.textContent = 'Demo — sample data, not a real campaign';
      document.body.appendChild(bar);
      document.body.style.paddingBottom = '48px';
      return;
    }

    var el = document.createElement('div');
    el.setAttribute('data-clipency-mode', m);
    el.style.cssText = [
      'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:99999',
      'font:500 11px/1.6 Inter,system-ui,sans-serif', 'letter-spacing:.06em',
      'text-transform:uppercase', 'text-align:center', 'padding:6px 12px',
      'backdrop-filter:blur(8px)',
      'background:' + (live ? 'rgba(11,11,11,.88)' : 'rgba(90,50,10,.92)'),
      'color:' + (live ? '#C9A227' : '#F5D89B'),
      'border-top:1px solid ' + (live ? 'rgba(201,162,39,.35)' : 'rgba(245,216,155,.35)')
    ].join(';');
    el.textContent = text;
    el.title = 'Clipency client portal — ' + m + ' mode';
    document.body.appendChild(el);
  }

  window.CLIPENCY_LIVE.ready = boot().then(function () {
    if (window.CLIPENCY_LIVE.mode === 'signed-out') return 'signed-out';
    if (document.body) banner();
    else document.addEventListener('DOMContentLoaded', banner);
    document.dispatchEvent(new CustomEvent('clipency:data-ready', {
      detail: { mode: window.CLIPENCY_LIVE.mode }
    }));
    return window.CLIPENCY_LIVE.mode;
  });
})();
