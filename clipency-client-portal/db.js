/* ============================================================
   CLIPENCY — client portal store (wallet + multi-campaign)
   ------------------------------------------------------------
   Persists in localStorage['clipency-store-v1'].
   THIS IS THE SUPABASE SWAP POINT for wallet/campaigns:
   replace load()/persist() with supabase.from('campaigns') /
   .from('wallet_transactions') queries — the rest of the UI
   reads only through the CLIPDB API below.

   Campaign schema (mirror in Supabase):
     id, name, code, banner, platforms[], cpm, budget,
     minViews, maxViewsPerVideo, maxPayPerVideo,
     status ('review'|'live'|'ended'), created, start, end
   ============================================================ */
window.CLIPDB = (function(){
  /* v2 on purpose. v1 stores in the wild contain the old seeded fiction
     (a $180 wallet, a $500 deposit, a "Tal's Pod" campaign). Reusing the
     key would let that survive in every browser that ever opened the
     portal, and load() keeps a stored campaign list over a fresh seed.
     Bumping the key retires it. */
  var KEY = 'clipency-store-v2';
  try{ localStorage.removeItem('clipency-store-v1'); }catch(e){}

  var TODAY = new Date().toISOString().slice(0,10);

  /* Campaign banner artworks — charcoal-first per design rules,
     gold only as a hairline accent. */
  var BANNERS = {
    ink:      {name:'Ink Wash',   css:'linear-gradient(135deg,#0B0B0B 0%,#242220 55%,#37332E 100%)'},
    mist:     {name:'Mist',       css:'linear-gradient(135deg,#1A1A1A 0%,#2E2A26 60%,#413B34 100%)'},
    mountain: {name:'Mountain',   css:'linear-gradient(160deg,#141210 0%,#201E1B 50%,#2A2724 100%)'},
    dusk:     {name:'Dusk',       css:'linear-gradient(135deg,#171514 0%,#26221E 45%,#1A1817 100%)'},
    ridge:    {name:'Ridge',      css:'linear-gradient(120deg,#0B0B0B 0%,#1E1B18 40%,#332F29 100%)'},
    ember:    {name:'Ember',      css:'linear-gradient(150deg,#141210 0%,#241F19 65%,#2E2620 100%)'}
  };

  var PLATFORMS = [
    {key:'instagram', label:'Instagram Reels'},
    {key:'youtube',   label:'YouTube Shorts'}
  ];

  var CATEGORIES = ['Podcast','Music','Gaming','UGC','Sports','Clipping','Edits','Finance','Other'];

  /* No WhatsApp. The number was rendered to every client in the contact
     modal; support is email or Discord. Removing it here as well as in
     shell.js means it cannot come back through another caller. */
  var ADMIN = {
    email:'ayush@clipency.in',
    discord:'https://discord.gg/4bmEfuJjsF'
  };

  /* An empty store, deliberately.

     This used to seed a fictional client: $180 wallet balance, a $500
     deposit dated 15 Jun, a "Tal's Pod" campaign with a $320 budget, and
     a login of client@talspod.com / clipency123. None of it came from
     the database, and because it was seeded into localStorage on first
     visit, EVERY client who ever opened the portal saw Tal's Pod's
     invented numbers before their own data loaded.

     Everything below is now filled by syncFromLive(), from the payload
     client_dashboard_data() returns for the signed-in client. Until
     that runs the store is honestly empty rather than confidently wrong. */
  function seed(){
    return {
      wallet: { balance: 0, transactions: [] },
      campaigns: [],
      profile: { name:'', email:'', phone:'', company:'', avatar:null },
      activeCampaignId: null
    };
  }

  var state;
  function load(){
    try{
      var raw = localStorage.getItem(KEY);
      state = raw ? JSON.parse(raw) : seed();
      if(!state.campaigns || !state.campaigns.length) state = seed();
      /* Fill any field an older stored campaign is missing. There is no
         longer a seed campaign to copy from — syncFromLive() overwrites
         this list from Supabase moments later anyway — so just make the
         shape safe to render. */
      var sd = seed();
      if(!state.profile) state.profile = sd.profile;
      if(!state.wallet)  state.wallet  = sd.wallet;
      state.campaigns.forEach(function(c){
        if(c.requirements === undefined) c.requirements = [];
        ['bannerImg','iconImg','contentLink'].forEach(function(k){
          if(c[k] === undefined) c[k] = null;
        });
        if(c.brand === undefined)    c.brand = c.name;
        if(c.category === undefined) c.category = 'Other';
        ['description','guidelines'].forEach(function(k){
          if(c[k] === undefined) c[k] = '';
        });
      });
    }catch(e){ state = seed(); }
  }
  function persist(){
    try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){}
  }
  load();

  /* ------------------------------------------------------------------
     syncFromLive() — the Supabase swap point the header promised.

     js/live.js calls this once it has the client's real payload, before
     any page paints (every page awaits CLIPENCY_LIVE.ready first). It
     rebuilds campaigns, wallet and profile from that payload.

     On the wallet: there is no client funding table in the database.
     `payment_transactions` is clipper payouts — it carries submission_id
     and payout_request_id — so a deposit ledger would have to be
     invented, which is exactly what was wrong before. Instead the wallet
     is derived from figures that are real:

         allocated = sum of campaign budgets
         spent     = sum of per-clip earnings at each campaign's own rate
         balance   = allocated - spent          (what is left to deliver)

     and the transaction list is one allocation row per real campaign.
     Every number a client sees is therefore traceable to a row.
     ------------------------------------------------------------------ */
  /* campaigns.status -> the vocabulary this UI renders.
     A paused campaign is not running and is not finished, so it maps to
     'review' (shown as "not live") rather than 'ended', which would tell
     a client their campaign is over when it can still be resumed. */
  /* Two-letter badge from the campaign name.

     This took the first two LETTERS of the whole string, so "Northwind
     Podcast" became "NO" and "Tal's Pod" became "TA". Word initials give
     the badge people expect: NP, TP. */
  function initials(title){
    var words = String(title || '').replace(/[^A-Za-z ]/g,' ').trim().split(/\s+/).filter(Boolean);
    if(!words.length) return 'CX';
    if(words.length === 1) return words[0].slice(0,2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  function portalStatus(s){
    s = String(s || '').toLowerCase();
    if(s === 'active' || s === 'live' || s === 'running') return 'live';
    if(s === 'ended' || s === 'completed' || s === 'complete' ||
       s === 'archived' || s === 'finished') return 'ended';
    return 'review';                       // paused, draft, pending, unknown
  }

  var PLAT_LABEL = {instagram:'Instagram', youtube:'YouTube', tiktok:'TikTok'};
  /* A campaign's name without its {tag}: "Vingo {UGC Campaign}" -> "Vingo". */
  function baseName(t){
    var raw = String(t || '').trim();
    var clean = raw.replace(/\s*[\[{(][^\]})]*[\]})]/g, '').replace(/\s{2,}/g, ' ').trim();
    return clean || raw;
  }
  function partName(name, p){ return baseName(name) + ' \u00b7 ' + (PLAT_LABEL[p] || p); }

  /* ---- one dashboard per platform ----
     campaigns.platform_split names a platform ('instagram'). The campaign
     is then shown as one card and one dashboard per platform it runs on,
     each holding only that platform's clips, reviews and creators. The
     named platform keeps the budget; the others show none of their own.
     Nothing is split in the database: every clip still bills the one
     campaign, so wherever the budget is shown its usage stays campaign-wide
     (stats() and applyActive() carry that as budgetSpend). Clippers are
     not affected: they still see one campaign.

     campaigns.platform_budgets ({"youtube": 20000, ...}, campaign currency)
     gives a platform a budget of its own, read against that platform's spend
     only. The named platform keeps whatever is not given away, read against
     the platforms without a budget of their own. Each half also shows the
     brand's price on its own platform (client_platform_rates), not the
     campaign's headline price. */
  function splitByPlatform(raw, mapped){
    var out = [];
    mapped.forEach(function(m, i){
      var keep = String((raw[i] && raw[i].platform_split) || '').trim().toLowerCase();
      if(!keep || m.platforms.length < 2){ out.push(m); return; }
      var plats = m.platforms.indexOf(keep) < 0 ? [keep].concat(m.platforms) : m.platforms;
      var order = [keep].concat(plats.filter(function(p){ return p !== keep; }));
      var alloc = m.platformBudgetsNative || null;
      var own = alloc ? order.filter(function(p){ return alloc[p] != null; }) : [];
      var ownN = own.reduce(function(a, p){ return a + alloc[p]; }, 0);
      var ownD = own.reduce(function(a, p){ return a + (m.platformBudgets[p] || 0); }, 0);
      order.forEach(function(p){
        var part = {};
        Object.keys(m).forEach(function(k){ part[k] = m[k]; });
        part.id = m.id + ':' + p;
        part.baseId = m.id;
        part.platform = p;
        part.platforms = [p];
        part.name = partName(m.name, p);
        part.code = initials(part.name);
        part.noBudget = p !== keep;
        part.budgetWith = partName(m.name, keep);
        if(p !== keep){
          part.bannerTint = p;
          part.budgetNative = 0; part.budget = 0;
          part.fee = 0; part.feePercent = null; part.creatorPool = 0;
        }
        /* the brand's price on this platform, when it has its own */
        if(m.platformRpvNative && m.platformRpvNative[p] != null){
          part.ratePerVideoNative = m.platformRpvNative[p];
          part.ratePerVideo = m.platformRpv[p];
        }
        part.budgetExcludes = own.filter(function(x){ return x !== p; });
        if(own.indexOf(p) >= 0){
          part.noBudget = false;
          part.budgetScope = 'platform';
          part.budgetNative = alloc[p];
          part.budget = m.platformBudgets[p];
        } else if(p === keep && own.length){
          part.budgetScope = 'rest';
          part.budgetNative = Math.max(0, Math.round((m.budgetNative - ownN) * 100) / 100);
          part.budget = Math.max(0, Math.round((m.budget - ownD) * 100) / 100);
        }
        out.push(part);
      });
    });
    return out;
  }

  function syncFromLive(){
    var C = window.CLIPENCY;
    var L = window.CLIPENCY_LIVE;
    if(!C || !L || !L.campaigns) return false;

    var camps = L.campaigns || [];

    function mapCampaign(c){
      var perMillion = Number(c.rpm) || Number(c.rate_per_million_usd) || 0;
      /* Money: native first (the campaign's own currency), then what the
         screen shows (dispCcy). An older payload with only USD figures is
         restated in native at the campaign's own fx rate. */
      var X = window.CXCUR;
      var ccy = String(c.currency || 'USD').toUpperCase();
      if(!X.info(ccy)) ccy = 'USD';
      var fx = Number(c.fx_rate_per_usd) > 0 ? Number(c.fx_rate_per_usd) : X.rate(ccy);
      var disp = X.target(ccy);
      function nat(n, usd){ return n != null ? (Number(n) || 0) : (Number(usd) || 0) * fx; }
      function natOrNull(n, usd){ return n != null ? Number(n) : (usd != null ? Number(usd) * fx : null); }
      function D(n){ return n == null ? null : X.conv(n, ccy, disp, fx); }
      var budgetN = nat(c.budget_native, Number(c.budget) || Number(c.budget_usd) || 0);
      var rpvN    = nat(c.rate_per_video_native, c.rate_per_video);
      var cpmN    = nat(c.rpm_native, perMillion) / 1000;
      var feeN    = natOrNull(c.platform_fee_native, c.platform_fee);
      var poolN   = natOrNull(c.creator_pool_native, c.creator_pool);
      var plats = String(c.platform || '').split(',')
        .map(function(p){ return p.trim().toLowerCase(); })
        .filter(Boolean);
      /* Split campaigns only: a budget per platform (campaign currency) and
         the brand's price per platform. Both optional; bad entries dropped. */
      function perPlatform(obj, pick){
        if(typeof obj === 'string'){ try { obj = JSON.parse(obj); } catch(e){ obj = null; } }
        if(!obj || typeof obj !== 'object') return null;
        var out = null;
        Object.keys(obj).forEach(function(k){
          var v = Number(pick(obj[k]));
          if(obj[k] != null && isFinite(v) && v >= 0) (out = out || {})[String(k).trim().toLowerCase()] = v;
        });
        return out;
      }
      function dispMap(o){
        if(!o) return null;
        var r = {}; Object.keys(o).forEach(function(k){ r[k] = D(o[k]); }); return r;
      }
      var pBudN = perPlatform(c.platform_budgets, function(v){ return v; });
      var pRpvN = perPlatform(c.client_platform_rates, function(v){ return v && v.rate_per_video; });
      return {
        id: c.id,
        name: c.title || 'Campaign',
        code: initials(c.title),
        banner: 'ink', bannerImg: c.asset_url || null, iconImg: c.icon_url || null,
        brand: c.brand_name || c.title || '',
        category: c.category || c.genre || c.type || 'Other',
        platforms: plats.length ? plats : ['instagram','youtube'],
        currency: ccy,            // the campaign's own currency
        fx: fx,                   // its units per USD, as stamped
        dispCcy: disp,            // what its figures below are shown in
        budgetNative: budgetN, ratePerVideoNative: rpvN, cpmNative: cpmN,
        cpm: D(cpmN),
        /* Which of the two rates is live. `cpm` is only meaningful under
           per_view; a per_video campaign zeroes rpm on save, so anything
           that multiplies views by cpm would quietly produce $0 rather
           than the truth. Screens branch on payoutModel instead. */
        payoutModel: String(c.payout_model || 'per_view'),
        ratePerVideo: D(rpvN),
        platformBudgetsNative: pBudN, platformBudgets: dispMap(pBudN),
        platformRpvNative: pRpvN, platformRpv: dispMap(pRpvN),
        isPrivate: !!c.is_private,
        budget: D(budgetN),
        /* The server decides what a client may see of the fee split, and on
           an agency campaign it withholds both figures on purpose. Never
           re-derive them here: a locally reconstructed fee would put back
           exactly what the server took out. null means withheld, not zero. */
        fee: D(feeN),
        feePercent: c.platform_fee_percent != null ? (Number(c.platform_fee_percent) || 0) : null,
        creatorPool: D(poolN),
        isAgency: !!c.is_agency,
        minViews: 0, maxViewsPerVideo: 0, maxPayPerVideo: 0,
        requirements: c.requirements
          ? String(c.requirements).split('\n').map(function(s){return s.trim();}).filter(Boolean)
          : [],
        description: c.description || '',
        contentLink: c.content_assets_url || null,
        guidelines: c.guidelines_url || '',
        /* The database and this UI use different words for the same
           thing. campaigns.status is 'active' | 'paused' | 'ended';
           the portal tests for 'live' | 'review' | 'ended'. Passing
           the raw value through meant an active campaign matched
           nothing, so Home reported "0 campaigns running" while
           showing that campaign's clips and spend directly beneath. */
        status: portalStatus(c.status),
        statusRaw: c.status || null,
        created: String(c.created_at || '').slice(0,10),
        start: String(c.start_date || c.created_at || '').slice(0,10),
        end: c.end_date || null
      };
    }
    state.campaigns = splitByPlatform(camps, camps.map(mapCampaign));

    /* Totals across campaigns are stated in one currency (aggCcy): the
       picked one, or in the default view the campaigns' shared currency,
       else USD. Each figure is converted from its native amount. */
    var X = window.CXCUR;
    var agg = aggCcy();
    function toAggN(c, n){ return X.conv(n, c.currency, agg, c.fx); }
    var allocated = state.campaigns.reduce(function(a,c){ return a + toAggN(c, c.budgetNative); }, 0);
    var feeTotal  = state.campaigns.reduce(function(a,c){
      return a + (c.fee == null ? 0 : toAggN(c, X.conv(c.fee, c.dispCcy, c.currency, c.fx)));
    }, 0);
    var allRows = (C.__allSubmissions && C.__allSubmissions.length) ? C.__allSubmissions : (C.submissions || []);
    var spent = allRows.filter(function(r){ return r.status === 'approved'; })
      .reduce(function(a,r){
        var n = r.amountNative != null ? r.amountNative : (r.amount || 0);
        return a + X.conv(n, r.ccy || 'USD', agg, r.fx);
      }, 0);
    allocated = Math.round(allocated * 100) / 100;
    feeTotal = Math.round(feeTotal * 100) / 100;
    spent = Math.round(spent * 100) / 100;

    /* Balance is now the real ledger balance when the payload carries one.
       Before this it was budgets-minus-spend, which is a different number
       entirely: it counted money already committed to campaigns as though it
       were still available. */
    /* NOT named L: `var` hoists to the top of the function, so a second
       `var L` here silently replaced the CLIPENCY_LIVE reference used further
       down, and the profile block then read wallet.email instead of the
       signed-in address. */
    var walletIn = (L && L.wallet) || null;
    var ledger = (walletIn && walletIn.ledger) || [];
    /* The wallet ledger is kept in USD (client_wallet_ledger). */
    var wCcy = String((walletIn && walletIn.currency) || 'USD').toUpperCase();
    state.wallet = {
      currency:  agg,
      balance:   walletIn ? Math.round(X.conv(Number(walletIn.balance || 0), wCcy, agg) * 100) / 100
                          : Math.round((allocated - spent) * 100) / 100,
      allocated: allocated,
      spent:     spent,
      /* If any campaign in the set withholds its split, the totals cannot be
         stated either — a sum that silently treats "withheld" as zero is a
         wrong number wearing a confident face. */
      platformFee: state.campaigns.some(function(c){ return c.fee == null; })
                     ? null : Math.round(feeTotal * 100) / 100,
      creatorPool: state.campaigns.some(function(c){ return c.creatorPool == null; })
                     ? null : Math.round((allocated - feeTotal) * 100) / 100,
      transactions: ledger.length
        ? ledger.map(function(r){
            return { id: r.id, type: r.kind,
                     amount: Math.round(X.conv(Number(r.amount), wCcy, agg) * 100) / 100,
                     date: String(r.created_at || '').slice(0,10),
                     note: r.note || r.kind };
          })
        : state.campaigns.filter(function(c){ return !c.noBudget; }).map(function(c){
            return { id: 'alloc-' + c.id, type: 'allocation',
                     amount: -Math.round(toAggN(c, c.budgetNative) * 100) / 100,
                     date: c.created || c.start, note: 'Campaign budget — ' + c.name };
          }).sort(function(a,b){ return String(b.date).localeCompare(String(a.date)); })
    };

    /* Profile comes from the signed-in account, not a stored fake. Keep
       any avatar the client uploaded locally — it has nowhere else to live. */
    var keptAvatar = state.profile && state.profile.avatar;
    var primary = state.campaigns[0];
    state.profile = {
      name: (primary && primary.brand) || (primary && primary.name) || 'Client',
      email: L.email || '',
      phone: (state.profile && state.profile.phone) || '',
      company: (primary && primary.brand) || (primary && primary.name) || '',
      avatar: keptAvatar || null
    };

    /* A link that names a campaign (?campaign=<id>, as in the Review emails)
       opens that campaign, if this client can see it. */
    try{
      var qc = new URLSearchParams(location.search).get('campaign');
      if(qc){
        var hit = get(qc);
        if(!hit){
          /* The bare id of a split campaign (the review emails link that
             way): open the platform with clips waiting, else the one that
             keeps the budget. */
          var parts = state.campaigns.filter(function(c){ return String(c.baseId) === String(qc); });
          var waiting = parts.filter(function(c){
            return (C.__allPending || []).some(function(r){ return String(r.campaignId) === String(qc) && r.platform === c.platform; });
          });
          hit = waiting.length === 1 ? waiting[0] : (parts.filter(function(c){ return !c.noBudget; })[0] || parts[0] || null);
        }
        if(hit) state.activeCampaignId = hit.id;
      }
    }catch(e){}
    if(!get(state.activeCampaignId) && state.campaigns.length){
      state.activeCampaignId = state.campaigns[0].id;
    }
    persist();
    return true;
  }

  function uid(p){ return p + Math.random().toString(36).slice(2,9); }
  /* One formatter for the portal. This had its own hardcoded dollar sign, so
     Budget and Profile disagreed with every other page the moment a campaign
     was priced in anything but USD. */
  /* A total across campaigns (wallet, portfolio): no ccy argument means
     the aggregate currency. One campaign's own figure: moneyC(c, v). */
  function money(v, ccy){
    return window.CXCUR.fmt(Number(v) || 0, ccy || (state.wallet && state.wallet.currency) || aggCcy());
  }
  function moneyC(c, v){ return window.CXCUR.fmt(Number(v) || 0, (c && c.dispCcy) || aggCcy()); }
  function aggCcy(){
    return window.CXCUR.targetForSet(state.campaigns.map(function(c){ return c.currency || 'USD'; }));
  }
  /* One campaign's displayed figure, restated in the aggregate currency. */
  function toAgg(c, v){
    if(!c) return Number(v) || 0;
    var from = c.dispCcy || c.currency || 'USD';
    return window.CXCUR.conv(v, from, aggCcy(), from === c.currency ? c.fx : undefined);
  }

  /* ---- campaign stats, computed from that campaign's own clips ----
     This used to be `if (c.id === 'tp')` — real numbers for the one
     hardcoded campaign and zeros for everything else, so a second
     campaign could never show anything. Now it filters the live clips
     by campaign id, which works for one campaign or ten. */
  function clipsFor(c){
    /* The master list: CLIPENCY.submissions is narrowed to the active
       campaign, which left every other card on Home reading zero. */
    var C0 = window.CLIPENCY || {};
    var subs = (C0.__allSubmissions && C0.__allSubmissions.length) ? C0.__allSubmissions
             : (C0.submissions || []);
    if(!subs.length) return [];
    var base = String(c.baseId || c.id);
    var mine = subs.filter(function(r){ return String(r.campaignId) === base && (!c.platform || r.platform === c.platform); });
    /* Single-campaign client: every clip is theirs. Guards the case
       where campaignId did not survive the mapping. */
    return mine.length ? mine : (state.campaigns.length <= 1 ? subs : []);
  }

  function stats(c){
    /* Approved only, like CLIPENCY.totals(): a flagged clip has been pulled
       and is not billed, so it must not count toward a card's spend. */
    var rows = clipsFor(c).filter(function(r){ return !r.status || r.status === 'approved'; });
    var views = 0, likes = 0, comments = 0, spend = 0;
    rows.forEach(function(r){
      views += r.views || 0; likes += r.likes || 0;
      comments += r.comments || 0; spend += r.amount || 0;
    });
    spend = Math.round(spend * 100) / 100;
    /* One half of a split campaign: the budget is the whole campaign's, so
       what is read against it is every platform's spend, not this one's. */
    var forBudget = spend;
    if(c.baseId){
      var C0 = window.CLIPENCY || {};
      var every = (C0.__allSubmissions && C0.__allSubmissions.length) ? C0.__allSubmissions : (C0.submissions || []);
      forBudget = 0;
      every.forEach(function(r){
        if(String(r.campaignId) !== String(c.baseId) || (r.status && r.status !== 'approved')) return;
        /* a platform with its own budget reads only its own spend; the shared
           budget reads every platform that has none of its own */
        if(c.budgetScope === 'platform' && r.platform !== c.platform) return;
        if(c.budgetScope !== 'platform' && c.budgetExcludes && c.budgetExcludes.indexOf(r.platform) >= 0) return;
        forBudget += r.amount || 0;
      });
      forBudget = Math.round(forBudget * 100) / 100;
    }
    if(!rows.length && !forBudget) return {views:0, clips:0, spend:0, budgetSpend:0, budgetUsed:0, likes:0, comments:0};
    return {
      views: views, clips: rows.length, spend: spend,
      budgetSpend: forBudget,
      budgetUsed: c.budget ? Math.round(forBudget / c.budget * 1000) / 10 : 0,
      likes: likes, comments: comments
    };
  }

  function get(id){ return state.campaigns.filter(function(c){ return c.id === id; })[0] || null; }
  function active(){ return get(state.activeCampaignId) || state.campaigns[0]; }

  var api = {
    BANNERS: BANNERS,
    PLATFORMS: PLATFORMS,
    CATEGORIES: CATEGORIES,
    ADMIN: ADMIN,
    TODAY: TODAY,
    money: money,
    moneyC: moneyC,
    toAgg: toAgg,
    aggCcy: aggCcy,

    /* Called by js/live.js once the client's real payload has arrived. */
    syncFromLive: syncFromLive,

    profile: function(){ return state.profile; },
    updateProfile: function(p){
      ['name','email','phone','company','avatar'].forEach(function(k){
        if(p[k] !== undefined) state.profile[k] = p[k];
      });
      persist();
      return {ok:true};
    },
    /* The password used to be a plain string in localStorage
       ('clipency123'), compared in the browser. It is now a real Supabase
       auth credential, so the change goes through auth.updateUser and the
       old password is verified by re-authenticating. Returns a promise;
       the caller already handles {ok,error}. */
    changePassword: async function(current, next){
      if(!next || next.length < 8) return {ok:false, error:'New password must be at least 8 characters.'};
      var sb = window.clipencySupabase;
      if(!sb) return {ok:false, error:'Not connected. Reload the page and try again.'};
      try{
        var email = (state.profile && state.profile.email) || '';
        if(!email) return {ok:false, error:'No account email on this session.'};
        var check = await sb.auth.signInWithPassword({email:email, password:current});
        if(check.error) return {ok:false, error:'Current password is incorrect.'};
        var up = await sb.auth.updateUser({password:next});
        if(up.error) return {ok:false, error:up.error.message};
        return {ok:true};
      }catch(e){ return {ok:false, error:(e && e.message) || 'Could not change the password.'}; }
    },

    /* 7-day spend digest, per campaign, from that campaign's own clips.
       Was gated on c.id === 'tp'; now every real campaign gets one. */
    weeklySpend: function(){
      var out = [];
      state.campaigns.forEach(function(c){
        var rows = clipsFor(c);
        if(rows.length && c.start){
          var byDay = {}, spendByDay = {};
          rows.forEach(function(r){
            if(!r.submitted) return;
            byDay[r.submitted] = (byDay[r.submitted] || 0) + (r.views || 0);
            spendByDay[r.submitted] = (spendByDay[r.submitted] || 0) + (r.amount || 0);
          });
          var days = Object.keys(byDay).sort().map(function(k){
            return {date:k, views:byDay[k], spend:spendByDay[k] || 0};
          });
          var weeks = {};
          days.forEach(function(d){
            /* A week used to be dropped when it had no views. On a per-video
               campaign the money does not come from views at all, so a week
               that billed real money vanished from the digest whenever the
               view counts had not landed yet. */
            if(!d.views && !d.spend) return;
            var t = new Date(c.start + 'T00:00:00');
            var dd = new Date(d.date + 'T00:00:00');
            var wk = Math.floor((dd - t) / (7 * 864e5));
            if(wk < 0) wk = 0;
            weeks[wk] = weeks[wk] || {views:0, spend:0};
            weeks[wk].views += d.views;
            weeks[wk].spend += d.spend;
          });
          Object.keys(weeks).sort(function(a,b){ return a - b; }).forEach(function(wk){
            var startD = new Date(new Date(c.start + 'T00:00:00').getTime() + wk * 7 * 864e5);
            var endD = new Date(startD.getTime() + 6 * 864e5);
            var iso = function(d){ return d.toISOString().slice(0,10); };
            var w = weeks[wk];
            /* Per-video weeks are priced from the clips actually billed in
               them - real money, and the only figure that means anything on
               a campaign where views buy nothing. This used to be null, and
               Budget printed null as $0.00, so every week of every per-video
               campaign read "$0.00 exhausted". Per-view keeps its rpm
               derivation, which is what that model actually charges on. */
            out.push({campaign:c.name, code:c.code, week:+wk + 1, from:iso(startD), to:iso(endD),
                      views:w.views,
                      spend:(c.payoutModel === 'per_video'
                             ? Math.round(w.spend * 100) / 100
                             : Math.round(w.views / 1000 * c.cpm * 100) / 100),
                      budget:c.budget, ccy:c.dispCcy});
          });
        }
      });
      return out.sort(function(a,b){ return b.from.localeCompare(a.from); });
    },

    campaigns: function(){ return state.campaigns.slice(); },
    get: get,
    active: active,
    stats: stats,

    setActive: function(id){
      if(get(id)){ state.activeCampaignId = id; persist(); }
    },

    wallet: function(){ return state.wallet; },

    addFunds: function(amount){
      amount = Math.round(Number(amount) * 100) / 100;
      if(!(amount > 0)) return {ok:false, error:'Enter a valid amount.'};
      state.wallet.balance = Math.round((state.wallet.balance + amount) * 100) / 100;
      state.wallet.transactions.unshift({id:uid('t'), type:'deposit', amount:amount, date:TODAY, note:'Funds added'});
      persist();
      return {ok:true, balance:state.wallet.balance};
    },

    createCampaign: function(cfg){
      var budget = Math.round(Number(cfg.budget) * 100) / 100;
      if(!cfg.name || !cfg.name.trim())        return {ok:false, error:'Give your campaign a name.'};
      if(!cfg.platforms || !cfg.platforms.length) return {ok:false, error:'Pick at least one platform.'};
      if(!(budget >= 50))                      return {ok:false, error:'Minimum campaign budget is $50.'};
      if(budget > state.wallet.balance)        return {ok:false, error:'Budget exceeds wallet balance — add funds first.'};
      /* Two payout models, two units. Validate whichever one is live rather
         than always demanding a per-view rate — a per-video campaign has no
         cpm at all, and asking for one was the reason this form could only
         ever create RPM campaigns. */
      var model = cfg.payoutModel === 'per_video' ? 'per_video' : 'per_view';
      if(model === 'per_video'){
        if(!(Number(cfg.ratePerVideo) > 0)) return {ok:false, error:'Set a rate per approved video.'};
      }else{
        if(!(Number(cfg.cpm) > 0))          return {ok:false, error:'Set a rate per 1,000 views.'};
      }
      var name = cfg.name.trim();
      var code = name.replace(/[^A-Za-z0-9 ]/g,'').split(/\s+/).map(function(w){ return w[0]; }).join('').slice(0,2).toUpperCase() || 'CP';
      var c = {
        id: uid('c'), name:name, code:code,
        banner: BANNERS[cfg.banner] ? cfg.banner : 'ink',
        bannerImg: cfg.bannerImg || null,
        iconImg: cfg.iconImg || null,
        brand: (cfg.brand || name).trim(),
        category: CATEGORIES.indexOf(cfg.category) > -1 ? cfg.category : 'Other',
        platforms: cfg.platforms.slice(),
        /* The inactive rate is zeroed, so nothing downstream can read a
           figure from the model that is not in play. */
        payoutModel: model,
        cpm: model === 'per_view' ? Math.round(Number(cfg.cpm)*100)/100 : 0,
        ratePerVideo: model === 'per_video' ? Math.round(Number(cfg.ratePerVideo)*100)/100 : 0,
        budget: budget,
        minViews: Math.max(0, Math.round(Number(cfg.minViews) || 0)),
        maxViewsPerVideo: Math.max(0, Math.round(Number(cfg.maxViewsPerVideo) || 0)),
        maxPayPerVideo: Math.max(0, Math.round(Number(cfg.maxPayPerVideo)*100)/100 || 0),
        requirements: (cfg.requirements || '').split('\n').map(function(s){ return s.trim(); }).filter(Boolean),
        description: (cfg.description || '').trim(),
        contentLink: (cfg.contentLink || '').trim() || null,
        guidelines: (cfg.guidelines || '').trim(),
        status:'review', created:TODAY,
        start: cfg.start || null, end: cfg.end || null
      };
      state.wallet.balance = Math.round((state.wallet.balance - budget) * 100) / 100;
      state.wallet.transactions.unshift({id:uid('t'), type:'allocation', amount:-budget, date:TODAY, note:'Campaign budget — ' + name});
      state.campaigns.push(c);
      persist();
      /* Supabase hook: supabase.from('campaigns').insert(c) */
      return {ok:true, campaign:c};
    },

    endCampaign: function(id){
      var c = get(id);
      if(!c || c.status === 'ended') return {ok:false};
      var refund = Math.max(0, Math.round(toAgg(c, c.budget - stats(c).spend) * 100) / 100);
      c.status = 'ended'; c.end = TODAY;
      if(refund > 0){
        state.wallet.balance = Math.round((state.wallet.balance + refund) * 100) / 100;
        state.wallet.transactions.unshift({id:uid('t'), type:'refund', amount:refund, date:TODAY, note:'Unspent budget returned — ' + c.name});
      }
      persist();
      return {ok:true, refund:refund};
    },

    removeCampaign: function(id){
      var c = get(id);
      if(!c) return {ok:false};
      if(c.status === 'review'){
        var back = Math.round(toAgg(c, c.budget) * 100) / 100;
        state.wallet.balance = Math.round((state.wallet.balance + back) * 100) / 100;
        state.wallet.transactions.unshift({id:uid('t'), type:'refund', amount:back, date:TODAY, note:'Campaign cancelled — ' + c.name});
      } else if(c.status !== 'ended'){
        return {ok:false, error:'End the campaign before removing it.'};
      }
      state.campaigns = state.campaigns.filter(function(x){ return x.id !== id; });
      if(state.activeCampaignId === id) state.activeCampaignId = (state.campaigns[0]||{}).id || 'tp';
      persist();
      return {ok:true};
    },

    /* Totals across every campaign (Home stat strip) */
    portfolio: function(){
      var t = {views:0, clips:0, spend:0, budget:0, running:0, currency: aggCcy()};
      state.campaigns.forEach(function(c){
        var s = stats(c);
        t.views += s.views; t.clips += s.clips;
        t.spend += toAgg(c, s.spend); t.budget += toAgg(c, c.budget);
        if(c.status === 'live' || c.status === 'review') t.running++;
      });
      t.spend = Math.round(t.spend * 100) / 100;
      t.budget = Math.round(t.budget * 100) / 100;
      return t;
    },

    /* Narrow the dashboard to the selected campaign.

       This was `if (c.id !== 'tp')` — it blanked the clip list for any
       campaign that was not the one hardcoded id. Real campaign ids are
       uuids, so that test was true for every genuine campaign and the
       portal wiped its own data. It also did `CLIPENCY.submissions = []`,
       reassigning the array that data.js closes over (`var S =
       C.submissions`), which silently detaches every helper from the
       list the pages read.

       Now: filter the master list in place, and never reassign. */
    applyActive: function(){
      var c = active();
      if(!window.CLIPENCY || !c) return c || null;

      var all = CLIPENCY.__allSubmissions;
      var base = String(c.baseId || c.id);
      function mine(r){ return String(r.campaignId) === base && (!c.platform || r.platform === c.platform); }
      if(all && all.length){
        var only = state.campaigns.length > 1 ? all.filter(mine) : all;
        CLIPENCY.submissions.length = 0;
        only.forEach(function(r){ CLIPENCY.submissions.push(r); });
      }
      /* Clips awaiting this client's approval, same narrowing. */
      var allP = CLIPENCY.__allPending;
      if(allP){
        if(!Array.isArray(CLIPENCY.pending)) CLIPENCY.pending = [];
        var onlyP = state.campaigns.length > 1 ? allP.filter(mine) : allP;
        CLIPENCY.pending.length = 0;
        onlyP.forEach(function(r){ CLIPENCY.pending.push(r); });
      }

      CLIPENCY.campaign.client = c.name;
      CLIPENCY.campaign.code   = c.code;
      CLIPENCY.campaign.label  = 'Live client portal · powered by Clipency';
      CLIPENCY.campaign.cpm    = c.cpm;
      CLIPENCY.campaign.payoutModel  = c.payoutModel || 'per_view';
      CLIPENCY.campaign.ratePerVideo = c.ratePerVideo || 0;
      CLIPENCY.campaign.isPrivate    = !!c.isPrivate;
      CLIPENCY.campaign.budget = c.budget;
      /* One half of a split campaign: which platform, whether it has a
         budget of its own, and the campaign-wide spend to read against the
         shared budget (null on an ordinary campaign). */
      CLIPENCY.campaign.baseId = base;
      CLIPENCY.campaign.platform = c.platform || null;
      CLIPENCY.campaign.noBudget = !!c.noBudget;
      CLIPENCY.campaign.budgetWith = c.budgetWith || null;
      CLIPENCY.campaign.budgetSpend = c.baseId ? stats(c).budgetSpend : null;
      /* The active campaign's figures, and C.money(), are in its display
         currency: its own in the default view, the picked one otherwise. */
      CLIPENCY.campaign.currency = c.dispCcy || 'USD';
      CLIPENCY.campaign.currencySymbol = window.CXCUR.symbol(CLIPENCY.campaign.currency);
      CLIPENCY.campaign.nativeCurrency = c.currency || 'USD';
      CLIPENCY.campaign.start  = c.start || c.created;
      CLIPENCY.campaign.end    = c.end;
      return c;
    }
  };
  return api;
})();

/* Do NOT apply at load. There is no campaign yet — the store seeds empty
   and is filled by syncFromLive() once Supabase answers. Calling it here
   used to dereference an undefined campaign. js/live.js applies it after
   the sync, before any page paints. */
