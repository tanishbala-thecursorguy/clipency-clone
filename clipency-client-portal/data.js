/* ============================================================
   CLIPENCY — demo fixture (sample data)
   ------------------------------------------------------------
   This file is the single source of truth for the dashboard.
   To go live with Supabase: replace the CLIPENCY.submissions
   array with the result of your query, e.g.

     const { data } = await supabase.from('submissions').select('*');
     CLIPENCY.submissions = data;

   Field schema (keep identical in your Supabase table):
     id, title, creator, platform ('tiktok'|'instagram'|'youtube'),
     status ('approved'|'rejected'|'pending'),
     views, likes, comments, submitted (YYYY-MM-DD), url, cover
   ============================================================ */
window.CLIPENCY = {
  campaign: {
    client: "Northwind Podcast",
    code: "NP",
    label: "Live client portal · powered by Clipency",
    cpm: 1.00,                      /* $ per 1,000 approved views */
    budget: 320.00,                 /* total campaign budget in $ — change per client */
    start: "2026-06-17",            /* campaign launch */
    end: null
  },
  submissions: [
  {
    "id": 1,
    "title": "Brutal truth about friends",
    "creator": "@viralvaultco",
    "platform": "instagram",
    "status": "approved",
    "views": 1583,
    "likes": 95,
    "comments": 10,
    "submitted": "2026-06-30",
    "url": "https://www.instagram.com/reel/C523ExQ2/",
    "cover": "https://picsum.photos/seed/nwpod-21/400/711"
  },
  {
    "id": 2,
    "title": "Why nobody talks about this",
    "creator": "@podpeaks",
    "platform": "youtube",
    "status": "approved",
    "views": 2903,
    "likes": 172,
    "comments": 19,
    "submitted": "2026-07-07",
    "url": "https://youtube.com/shorts/cl23102",
    "cover": "https://picsum.photos/seed/nwpod-27/400/711"
  },
  {
    "id": 3,
    "title": "Wildest childhood memory",
    "creator": "@framefarmer",
    "platform": "instagram",
    "status": "approved",
    "views": 14223,
    "likes": 717,
    "comments": 63,
    "submitted": "2026-06-20",
    "url": "https://www.instagram.com/reel/C182DxQ2/",
    "cover": "https://picsum.photos/seed/nwpod-6/400/711"
  },
  {
    "id": 4,
    "title": "The interview walk-out",
    "creator": "@shortformsage",
    "platform": "youtube",
    "status": "rejected",
    "views": 1642,
    "likes": 75,
    "comments": 7,
    "submitted": "2026-07-20",
    "url": "https://youtube.com/shorts/cl40842",
    "cover": "https://picsum.photos/seed/nwpod-47/400/711"
  },
  {
    "id": 5,
    "title": "The text he never sent",
    "creator": "@dailydistill",
    "platform": "instagram",
    "status": "approved",
    "views": 1713,
    "likes": 119,
    "comments": 6,
    "submitted": "2026-07-02",
    "url": "https://www.instagram.com/reel/C4E5FxQ2/",
    "cover": "https://picsum.photos/seed/nwpod-20/400/711"
  },
  {
    "id": 6,
    "title": "The 3am phone call story",
    "creator": "@reelriot",
    "platform": "instagram",
    "status": "approved",
    "views": 4653,
    "likes": 283,
    "comments": 37,
    "submitted": "2026-06-20",
    "url": "https://www.instagram.com/reel/C106FxQ2/",
    "cover": "https://picsum.photos/seed/nwpod-4/400/711"
  },
  {
    "id": 7,
    "title": "This clip went viral overnight",
    "creator": "@loopedmedia",
    "platform": "instagram",
    "status": "pending",
    "views": 1000,
    "likes": 50,
    "comments": 6,
    "submitted": "2026-07-20",
    "url": "https://www.instagram.com/reel/CBAC3xQ2/",
    "cover": "https://picsum.photos/seed/nwpod-48/400/711"
  },
  {
    "id": 8,
    "title": "First job confessions",
    "creator": "@dailydistill",
    "platform": "instagram",
    "status": "approved",
    "views": 1427,
    "likes": 91,
    "comments": 12,
    "submitted": "2026-07-13",
    "url": "https://www.instagram.com/reel/C9BCBxQ2/",
    "cover": "https://picsum.photos/seed/nwpod-40/400/711"
  },
  {
    "id": 9,
    "title": "He said WHAT about money?",
    "creator": "@dailydistill",
    "platform": "instagram",
    "status": "approved",
    "views": 1511,
    "likes": 122,
    "comments": 10,
    "submitted": "2026-07-07",
    "url": "https://www.instagram.com/reel/C7515xQ2/",
    "cover": "https://picsum.photos/seed/nwpod-30/400/711"
  },
  {
    "id": 10,
    "title": "The moment the host lost it on air",
    "creator": "@framefarmer",
    "platform": "instagram",
    "status": "approved",
    "views": 4102,
    "likes": 269,
    "comments": 18,
    "submitted": "2026-07-05",
    "url": "https://www.instagram.com/reel/C6599xQ2/",
    "cover": "https://picsum.photos/seed/nwpod-26/400/711"
  },
  {
    "id": 11,
    "title": "The story behind the tattoo",
    "creator": "@snipstudio",
    "platform": "youtube",
    "status": "approved",
    "views": 2215,
    "likes": 164,
    "comments": 22,
    "submitted": "2026-07-11",
    "url": "https://youtube.com/shorts/cl30198",
    "cover": "https://picsum.photos/seed/nwpod-35/400/711"
  },
  {
    "id": 12,
    "title": "Brutal truth about friends",
    "creator": "@loopedmedia",
    "platform": "instagram",
    "status": "rejected",
    "views": 2158,
    "likes": 178,
    "comments": 20,
    "submitted": "2026-07-18",
    "url": "https://www.instagram.com/reel/CB305xQ2/",
    "cover": "https://picsum.photos/seed/nwpod-46/400/711"
  },
  {
    "id": 13,
    "title": "This guest story is unreal",
    "creator": "@shortformsage",
    "platform": "youtube",
    "status": "approved",
    "views": 1423,
    "likes": 76,
    "comments": 5,
    "submitted": "2026-06-19",
    "url": "https://youtube.com/shorts/cl01814",
    "cover": "https://picsum.photos/seed/nwpod-3/400/711"
  },
  {
    "id": 14,
    "title": "The awkward silence",
    "creator": "@reelriot",
    "platform": "instagram",
    "status": "approved",
    "views": 1943,
    "likes": 111,
    "comments": 6,
    "submitted": "2026-07-03",
    "url": "https://www.instagram.com/reel/C5DDBxQ2/",
    "cover": "https://picsum.photos/seed/nwpod-24/400/711"
  },
  {
    "id": 15,
    "title": "The gym theory",
    "creator": "@framefarmer",
    "platform": "instagram",
    "status": "approved",
    "views": 1489,
    "likes": 90,
    "comments": 8,
    "submitted": "2026-06-27",
    "url": "https://www.instagram.com/reel/C3EE3xQ2/",
    "cover": "https://picsum.photos/seed/nwpod-16/400/711"
  },
  {
    "id": 16,
    "title": "The interview walk-out",
    "creator": "@northwind.daily",
    "platform": "instagram",
    "status": "approved",
    "views": 8670,
    "likes": 599,
    "comments": 55,
    "submitted": "2026-07-04",
    "url": "https://www.instagram.com/reel/C561DxQ2/",
    "cover": "https://picsum.photos/seed/nwpod-22/400/711"
  },
  {
    "id": 17,
    "title": "The 3am phone call story",
    "creator": "@cutcraft",
    "platform": "youtube",
    "status": "approved",
    "views": 1434,
    "likes": 69,
    "comments": 8,
    "submitted": "2026-07-07",
    "url": "https://youtube.com/shorts/cl24876",
    "cover": "https://picsum.photos/seed/nwpod-29/400/711"
  },
  {
    "id": 18,
    "title": "First job confessions",
    "creator": "@snipstudio",
    "platform": "youtube",
    "status": "approved",
    "views": 2363,
    "likes": 170,
    "comments": 17,
    "submitted": "2026-06-29",
    "url": "https://youtube.com/shorts/cl12458",
    "cover": "https://picsum.photos/seed/nwpod-15/400/711"
  },
  {
    "id": 19,
    "title": "Rapid fire gone wrong",
    "creator": "@northwind.daily",
    "platform": "instagram",
    "status": "approved",
    "views": 3951,
    "likes": 228,
    "comments": 13,
    "submitted": "2026-06-25",
    "url": "https://www.instagram.com/reel/C2F67xQ2/",
    "cover": "https://picsum.photos/seed/nwpod-12/400/711"
  },
  {
    "id": 20,
    "title": "Guest breaks down on the pod",
    "creator": "@shortformsage",
    "platform": "youtube",
    "status": "approved",
    "views": 2251,
    "likes": 118,
    "comments": 8,
    "submitted": "2026-07-10",
    "url": "https://youtube.com/shorts/cl28424",
    "cover": "https://picsum.photos/seed/nwpod-33/400/711"
  },
  {
    "id": 21,
    "title": "He said WHAT about money?",
    "creator": "@snipstudio",
    "platform": "youtube",
    "status": "approved",
    "views": 1437,
    "likes": 74,
    "comments": 6,
    "submitted": "2026-06-20",
    "url": "https://youtube.com/shorts/cl03588",
    "cover": "https://picsum.photos/seed/nwpod-5/400/711"
  },
  {
    "id": 22,
    "title": "The $10k mistake",
    "creator": "@loopedmedia",
    "platform": "instagram",
    "status": "approved",
    "views": 1412,
    "likes": 83,
    "comments": 11,
    "submitted": "2026-07-14",
    "url": "https://www.instagram.com/reel/C940DxQ2/",
    "cover": "https://picsum.photos/seed/nwpod-38/400/711"
  },
  {
    "id": 23,
    "title": "The silent treatment story",
    "creator": "@loopedmedia",
    "platform": "instagram",
    "status": "approved",
    "views": 1455,
    "likes": 71,
    "comments": 7,
    "submitted": "2026-06-29",
    "url": "https://www.instagram.com/reel/C46A1xQ2/",
    "cover": "https://picsum.photos/seed/nwpod-18/400/711"
  },
  {
    "id": 24,
    "title": "Rapid fire gone wrong",
    "creator": "@podpeaks",
    "platform": "youtube",
    "status": "approved",
    "views": 1552,
    "likes": 91,
    "comments": 11,
    "submitted": "2026-07-12",
    "url": "https://youtube.com/shorts/cl31972",
    "cover": "https://picsum.photos/seed/nwpod-37/400/711"
  },
  {
    "id": 25,
    "title": "When the mic stayed on",
    "creator": "@viralvaultco",
    "platform": "instagram",
    "status": "approved",
    "views": 2377,
    "likes": 120,
    "comments": 11,
    "submitted": "2026-06-23",
    "url": "https://www.instagram.com/reel/C2B88xQ2/",
    "cover": "https://picsum.photos/seed/nwpod-11/400/711"
  },
  {
    "id": 26,
    "title": "Why he quit his job live",
    "creator": "@cutcraft",
    "platform": "youtube",
    "status": "approved",
    "views": 1999,
    "likes": 135,
    "comments": 13,
    "submitted": "2026-06-28",
    "url": "https://youtube.com/shorts/cl16006",
    "cover": "https://picsum.photos/seed/nwpod-19/400/711"
  },
  {
    "id": 27,
    "title": "When the guest fought back",
    "creator": "@snipstudio",
    "platform": "youtube",
    "status": "approved",
    "views": 1518,
    "likes": 113,
    "comments": 10,
    "submitted": "2026-07-05",
    "url": "https://youtube.com/shorts/cl21328",
    "cover": "https://picsum.photos/seed/nwpod-25/400/711"
  },
  {
    "id": 28,
    "title": "Guest breaks down on the pod",
    "creator": "@loopedmedia",
    "platform": "instagram",
    "status": "approved",
    "views": 1697,
    "likes": 102,
    "comments": 7,
    "submitted": "2026-06-23",
    "url": "https://www.instagram.com/reel/C1FEBxQ2/",
    "cover": "https://picsum.photos/seed/nwpod-8/400/711"
  },
  {
    "id": 29,
    "title": "The advice that changed everything",
    "creator": "@northwind.daily",
    "platform": "instagram",
    "status": "approved",
    "views": 1726,
    "likes": 120,
    "comments": 14,
    "submitted": "2026-07-09",
    "url": "https://www.instagram.com/reel/C7CD3xQ2/",
    "cover": "https://picsum.photos/seed/nwpod-32/400/711"
  },
  {
    "id": 30,
    "title": "The text he never sent",
    "creator": "@framefarmer",
    "platform": "instagram",
    "status": "rejected",
    "views": 2874,
    "likes": 238,
    "comments": 27,
    "submitted": "2026-07-16",
    "url": "https://www.instagram.com/reel/CAF26xQ2/",
    "cover": "https://picsum.photos/seed/nwpod-45/400/711"
  },
  {
    "id": 31,
    "title": "Landlord horror story",
    "creator": "@cutcraft",
    "platform": "youtube",
    "status": "approved",
    "views": 1834,
    "likes": 90,
    "comments": 8,
    "submitted": "2026-07-12",
    "url": "https://youtube.com/shorts/cl33746",
    "cover": "https://picsum.photos/seed/nwpod-39/400/711"
  },
  {
    "id": 32,
    "title": "Dating in 2026 is broken",
    "creator": "@podpeaks",
    "platform": "youtube",
    "status": "approved",
    "views": 1735,
    "likes": 91,
    "comments": 12,
    "submitted": "2026-06-28",
    "url": "https://youtube.com/shorts/cl14232",
    "cover": "https://picsum.photos/seed/nwpod-17/400/711"
  },
  {
    "id": 33,
    "title": "The gym theory",
    "creator": "@viralvaultco",
    "platform": "instagram",
    "status": "approved",
    "views": 1880,
    "likes": 84,
    "comments": 11,
    "submitted": "2026-07-15",
    "url": "https://www.instagram.com/reel/C9FAAxQ2/",
    "cover": "https://picsum.photos/seed/nwpod-41/400/711"
  },
  {
    "id": 34,
    "title": "Landlord horror story",
    "creator": "@reelriot",
    "platform": "instagram",
    "status": "approved",
    "views": 1482,
    "likes": 93,
    "comments": 11,
    "submitted": "2026-06-27",
    "url": "https://www.instagram.com/reel/C3725xQ2/",
    "cover": "https://picsum.photos/seed/nwpod-14/400/711"
  },
  {
    "id": 35,
    "title": "The $10k mistake",
    "creator": "@shortformsage",
    "platform": "youtube",
    "status": "approved",
    "views": 2541,
    "likes": 210,
    "comments": 22,
    "submitted": "2026-06-27",
    "url": "https://youtube.com/shorts/cl10684",
    "cover": "https://picsum.photos/seed/nwpod-13/400/711"
  },
  {
    "id": 36,
    "title": "This guest story is unreal",
    "creator": "@loopedmedia",
    "platform": "instagram",
    "status": "approved",
    "views": 1424,
    "likes": 107,
    "comments": 8,
    "submitted": "2026-07-08",
    "url": "https://www.instagram.com/reel/C6D57xQ2/",
    "cover": "https://picsum.photos/seed/nwpod-28/400/711"
  },
  {
    "id": 37,
    "title": "Dating in 2026 is broken",
    "creator": "@northwind.daily",
    "platform": "instagram",
    "status": "approved",
    "views": 2796,
    "likes": 197,
    "comments": 24,
    "submitted": "2026-07-15",
    "url": "https://www.instagram.com/reel/CA389xQ2/",
    "cover": "https://picsum.photos/seed/nwpod-42/400/711"
  },
  {
    "id": 38,
    "title": "This take is too honest",
    "creator": "@reelriot",
    "platform": "instagram",
    "status": "approved",
    "views": 2134,
    "likes": 164,
    "comments": 11,
    "submitted": "2026-07-10",
    "url": "https://www.instagram.com/reel/C8491xQ2/",
    "cover": "https://picsum.photos/seed/nwpod-34/400/711"
  },
  {
    "id": 39,
    "title": "The advice that changed everything",
    "creator": "@podpeaks",
    "platform": "youtube",
    "status": "approved",
    "views": 2591,
    "likes": 189,
    "comments": 26,
    "submitted": "2026-06-22",
    "url": "https://youtube.com/shorts/cl05362",
    "cover": "https://picsum.photos/seed/nwpod-7/400/711"
  },
  {
    "id": 40,
    "title": "The moment the host lost it on air",
    "creator": "@viralvaultco",
    "platform": "instagram",
    "status": "approved",
    "views": 1404,
    "likes": 112,
    "comments": 9,
    "submitted": "2026-06-18",
    "url": "https://www.instagram.com/reel/C4D2xQ2/",
    "cover": "https://picsum.photos/seed/nwpod-1/400/711"
  },
  {
    "id": 41,
    "title": "Why nobody talks about this",
    "creator": "@northwind.daily",
    "platform": "instagram",
    "status": "approved",
    "views": 1956,
    "likes": 115,
    "comments": 12,
    "submitted": "2026-06-20",
    "url": "https://www.instagram.com/reel/C8B1xQ2/",
    "cover": "https://picsum.photos/seed/nwpod-2/400/711"
  },
  {
    "id": 42,
    "title": "This take is too honest",
    "creator": "@cutcraft",
    "platform": "youtube",
    "status": "approved",
    "views": 1750,
    "likes": 89,
    "comments": 9,
    "submitted": "2026-06-21",
    "url": "https://youtube.com/shorts/cl07136",
    "cover": "https://picsum.photos/seed/nwpod-9/400/711"
  },
  {
    "id": 43,
    "title": "Why he quit his job live",
    "creator": "@reelriot",
    "platform": "instagram",
    "status": "approved",
    "views": 1605,
    "likes": 129,
    "comments": 11,
    "submitted": "2026-07-16",
    "url": "https://www.instagram.com/reel/CAB47xQ2/",
    "cover": "https://picsum.photos/seed/nwpod-44/400/711"
  },
  {
    "id": 44,
    "title": "When the mic stayed on",
    "creator": "@framefarmer",
    "platform": "instagram",
    "status": "approved",
    "views": 2347,
    "likes": 149,
    "comments": 10,
    "submitted": "2026-07-12",
    "url": "https://www.instagram.com/reel/C8C4FxQ2/",
    "cover": "https://picsum.photos/seed/nwpod-36/400/711"
  },
  {
    "id": 45,
    "title": "The story behind the tattoo",
    "creator": "@dailydistill",
    "platform": "instagram",
    "status": "approved",
    "views": 1936,
    "likes": 151,
    "comments": 10,
    "submitted": "2026-06-22",
    "url": "https://www.instagram.com/reel/C27A9xQ2/",
    "cover": "https://picsum.photos/seed/nwpod-10/400/711"
  },
  {
    "id": 46,
    "title": "This clip went viral overnight",
    "creator": "@shortformsage",
    "platform": "youtube",
    "status": "approved",
    "views": 2646,
    "likes": 170,
    "comments": 23,
    "submitted": "2026-07-01",
    "url": "https://youtube.com/shorts/cl19554",
    "cover": "https://picsum.photos/seed/nwpod-23/400/711"
  },
  {
    "id": 47,
    "title": "The silent treatment story",
    "creator": "@shortformsage",
    "platform": "youtube",
    "status": "approved",
    "views": 1822,
    "likes": 110,
    "comments": 12,
    "submitted": "2026-07-15",
    "url": "https://youtube.com/shorts/cl37294",
    "cover": "https://picsum.photos/seed/nwpod-43/400/711"
  },
  {
    "id": 48,
    "title": "Wildest childhood memory",
    "creator": "@viralvaultco",
    "platform": "instagram",
    "status": "approved",
    "views": 3684,
    "likes": 245,
    "comments": 23,
    "submitted": "2026-07-07",
    "url": "https://www.instagram.com/reel/C78F4xQ2/",
    "cover": "https://picsum.photos/seed/nwpod-31/400/711"
  }
]
};

/* ---------------- helpers ---------------- */
(function(C){
  var S = C.submissions;
  /* A flagged clip stays live and counts as approved: the flag is a note on
     the clip, not a removal. Only 'rejected' is out of the feed. */
  C.approved = function(){ return S.filter(function(r){return r.status==='approved' || r.status==='flagged';}); };
  C.totals = function(){
    var ap = C.approved();
    var apViews = ap.reduce(function(a,r){return a+r.views;},0);
    var allViews = S.reduce(function(a,r){return a+r.views;},0);
    return {
      approvedViews: apViews,
      allViews: allViews,
      approvedCount: ap.length,
      allCount: S.length,
      rejectedCount: S.filter(function(r){return r.status==='rejected';}).length,
      pendingCount: S.filter(function(r){return r.status==='pending';}).length,
      likes: S.reduce(function(a,r){return a+r.likes;},0),
      comments: S.reduce(function(a,r){return a+r.comments;},0),
      /* Sum the per-clip amounts the server priced, rather than pricing
         views here. A per-video campaign has no per-view rate at all, so
         views/1000 * cpm reported $0 against a campaign that was billing. */
      spend: Math.round(ap.reduce(function(a,r){return a+(r.amount||0);},0) * 100) / 100,
      budget: C.campaign.budget,
      budgetUsed: C.campaign.budget
        ? Math.round(ap.reduce(function(a,r){return a+(r.amount||0);},0) / C.campaign.budget * 1000) / 10
        : 0,
      approvalRate: Math.round(ap.length / S.length * 1000) / 10
    };
  };
  C.fmt = function(n){
    if(n >= 1e6) return (n/1e6).toFixed(1)+'M';
    if(n >= 1e3) return (n/1e3).toFixed(1)+'K';
    return String(n);
  };
  C.fmtFull = function(n){ return n.toLocaleString('en-US'); };
  C.money = function(n){ return '$' + n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); };
  C.top = function(n){
    return C.approved().slice().sort(function(a,b){
      return (b.views + b.likes*10) - (a.views + a.likes*10);   /* views + engagement weight */
    }).slice(0, n);
  };
  C.daily = function(){
    /* views AND money per day + cumulative views, approved only.
       Spend is summed from each clip's own priced amount, so it is right
       under both payout models — a per-view campaign and a per-video one
       total correctly side by side, and neither is derived from the other's
       unit. */
    var map = {}, smap = {};
    C.approved().forEach(function(r){
      map[r.submitted]  = (map[r.submitted]||0) + r.views;
      smap[r.submitted] = (smap[r.submitted]||0) + (r.amount||0);
    });
    var days = [], d = new Date(C.campaign.start), today = new Date('2026-07-20');
    while(d <= today){
      var k = d.toISOString().slice(0,10);
      days.push({date:k, views: map[k]||0, spend: Math.round((smap[k]||0)*100)/100});
      d.setDate(d.getDate()+1);
    }
    var cum = 0;
    days.forEach(function(x){ cum += x.views; x.cum = cum; });
    return days;
  };
  C.byCreator = function(){
    /* client view: live clips only */
    var map = {};
    C.approved().forEach(function(r){
      var m = map[r.creator] = map[r.creator] || {creator:r.creator, platform:r.platform, clips:0, views:0, likes:0, comments:0, spend:0};
      m.clips++; m.likes += r.likes; m.comments += r.comments;
      m.views += r.views; m.spend += (r.amount||0);
    });
    return Object.keys(map).map(function(k){ return map[k]; })
      .sort(function(a,b){ return b.views - a.views; });
  };
  C.engagement = function(){
    var ap = C.approved();
    var v = ap.reduce(function(a,r){return a+r.views;},0);
    var e = ap.reduce(function(a,r){return a+r.likes+r.comments;},0);
    return v ? e/v*100 : 0;
  };
  C.bestDay = function(){
    var best = null;
    C.daily().forEach(function(d){ if(!best || d.views > best.views) best = d; });
    return best;
  };
  C.byPlatform = function(){
    var map = {};
    C.approved().forEach(function(r){
      var m = map[r.platform] = map[r.platform] || {platform:r.platform, clips:0, views:0};
      m.clips++; m.views += r.views;
    });
    return Object.keys(map).map(function(k){ return map[k]; })
      .sort(function(a,b){ return b.views - a.views; });
  };
})(window.CLIPENCY);
