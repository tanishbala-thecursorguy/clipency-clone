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

  function syncFromLive(){
    var C = window.CLIPENCY;
    var L = window.CLIPENCY_LIVE;
    if(!C || !L || !L.campaigns) return false;

    var camps = L.campaigns || [];

    state.campaigns = camps.map(function(c){
      var perMillion = Number(c.rpm) || Number(c.rate_per_million_usd) || 0;
      var plats = String(c.platform || '').split(',')
        .map(function(p){ return p.trim().toLowerCase(); })
        .filter(Boolean);
      return {
        id: c.id,
        name: c.title || 'Campaign',
        code: initials(c.title),
        banner: 'ink', bannerImg: c.asset_url || null, iconImg: c.icon_url || null,
        brand: c.brand_name || c.title || '',
        category: c.category || c.genre || c.type || 'Other',
        platforms: plats.length ? plats : ['instagram','youtube'],
        cpm: perMillion / 1000,
        budget: Number(c.budget) || Number(c.budget_usd) || 0,
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
    });

    var allocated = state.campaigns.reduce(function(a,c){ return a + c.budget; }, 0);
    var spent = (C.submissions || []).reduce(function(a,r){ return a + (r.amount || 0); }, 0);
    spent = Math.round(spent * 100) / 100;

    state.wallet = {
      balance: Math.round((allocated - spent) * 100) / 100,
      allocated: allocated,
      spent: spent,
      transactions: state.campaigns.map(function(c){
        return { id: 'alloc-' + c.id, type: 'allocation', amount: -c.budget,
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

    if(!get(state.activeCampaignId) && state.campaigns.length){
      state.activeCampaignId = state.campaigns[0].id;
    }
    persist();
    return true;
  }

  function uid(p){ return p + Math.random().toString(36).slice(2,9); }
  function money(v){ return '$' + Number(v).toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2}); }

  /* ---- campaign stats, computed from that campaign's own clips ----
     This used to be `if (c.id === 'tp')` — real numbers for the one
     hardcoded campaign and zeros for everything else, so a second
     campaign could never show anything. Now it filters the live clips
     by campaign id, which works for one campaign or ten. */
  function clipsFor(c){
    var subs = (window.CLIPENCY && CLIPENCY.submissions) || [];
    if(!subs.length) return [];
    var mine = subs.filter(function(r){ return String(r.campaignId) === String(c.id); });
    /* Single-campaign client: every clip is theirs. Guards the case
       where campaignId did not survive the mapping. */
    return mine.length ? mine : (state.campaigns.length <= 1 ? subs : []);
  }

  function stats(c){
    var rows = clipsFor(c);
    if(!rows.length) return {views:0, clips:0, spend:0, budgetUsed:0, likes:0, comments:0};
    var views = 0, likes = 0, comments = 0, spend = 0;
    rows.forEach(function(r){
      views += r.views || 0; likes += r.likes || 0;
      comments += r.comments || 0; spend += r.amount || 0;
    });
    spend = Math.round(spend * 100) / 100;
    return {
      views: views, clips: rows.length, spend: spend,
      budgetUsed: c.budget ? Math.round(spend / c.budget * 1000) / 10 : 0,
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
          var byDay = {};
          rows.forEach(function(r){
            if(r.submitted) byDay[r.submitted] = (byDay[r.submitted] || 0) + (r.views || 0);
          });
          var days = Object.keys(byDay).sort().map(function(k){ return {date:k, views:byDay[k]}; });
          var weeks = {};
          days.forEach(function(d){
            if(!d.views) return;
            var t = new Date(c.start + 'T00:00:00');
            var dd = new Date(d.date + 'T00:00:00');
            var wk = Math.floor((dd - t) / (7 * 864e5));
            if(wk < 0) wk = 0;
            weeks[wk] = (weeks[wk] || 0) + d.views;
          });
          Object.keys(weeks).sort(function(a,b){ return a - b; }).forEach(function(wk){
            var startD = new Date(new Date(c.start + 'T00:00:00').getTime() + wk * 7 * 864e5);
            var endD = new Date(startD.getTime() + 6 * 864e5);
            var iso = function(d){ return d.toISOString().slice(0,10); };
            out.push({campaign:c.name, code:c.code, week:+wk + 1, from:iso(startD), to:iso(endD),
                      views:weeks[wk], spend:Math.round(weeks[wk] / 1000 * c.cpm * 100) / 100, budget:c.budget});
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
      if(!(Number(cfg.cpm) > 0))               return {ok:false, error:'Set a rate per 1,000 views.'};
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
        cpm: Math.round(Number(cfg.cpm)*100)/100,
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
      var refund = Math.max(0, Math.round((c.budget - stats(c).spend) * 100) / 100);
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
        state.wallet.balance = Math.round((state.wallet.balance + c.budget) * 100) / 100;
        state.wallet.transactions.unshift({id:uid('t'), type:'refund', amount:c.budget, date:TODAY, note:'Campaign cancelled — ' + c.name});
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
      var t = {views:0, clips:0, spend:0, budget:0, running:0};
      state.campaigns.forEach(function(c){
        var s = stats(c);
        t.views += s.views; t.clips += s.clips; t.spend += s.spend; t.budget += c.budget;
        if(c.status === 'live' || c.status === 'review') t.running++;
      });
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
      if(all && all.length){
        var only = state.campaigns.length > 1
          ? all.filter(function(r){ return String(r.campaignId) === String(c.id); })
          : all;
        CLIPENCY.submissions.length = 0;
        only.forEach(function(r){ CLIPENCY.submissions.push(r); });
      }

      CLIPENCY.campaign.client = c.name;
      CLIPENCY.campaign.code   = c.code;
      CLIPENCY.campaign.label  = 'Live client portal · powered by Clipency';
      CLIPENCY.campaign.cpm    = c.cpm;
      CLIPENCY.campaign.budget = c.budget;
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
