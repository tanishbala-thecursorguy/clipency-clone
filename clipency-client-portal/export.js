/* ============================================================
   CLIPENCY — campaign report export (.xlsx)
   Builds a branded, formatted workbook for the ACTIVE campaign:
   Summary · Clips · Creators · Billing.
   ExcelJS is lazy-loaded from cdnjs on first use.
   ============================================================ */
window.CLIPEXPORT = (function(){

  var INK = 'FF0B0B0B', PAPER = 'FFF5F2ED', CREAM = 'FFEDE8DF',
      GOLD = 'FFD8AA74', BRONZE = 'FF8C6A45', SOFT = 'FFFAF8F5',
      OK = 'FF5A7A52', BAD = 'FFB4543C';

  function loadLib(){
    return new Promise(function(res, rej){
      if(window.ExcelJS) return res();
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
      s.onload = res; s.onerror = function(){ rej(new Error('Could not load export library')); };
      document.head.appendChild(s);
    });
  }

  function hair(){ return {style:'thin', color:{argb:'FFD8D2C8'}}; }
  function boxBorder(){ return {top:hair(), left:hair(), bottom:hair(), right:hair()}; }

  function sheetShell(wb, name, cols){
    var ws = wb.addWorksheet(name, {views:[{showGridLines:false}], properties:{defaultRowHeight:18}});
    ws.columns = cols;
    return ws;
  }

  /* Big black brand band at the top of a sheet */
  function brandBand(ws, span, title, sub){
    ws.mergeCells(1,1,1,span); ws.mergeCells(2,1,2,span); ws.mergeCells(3,1,3,span);
    var r1 = ws.getCell(1,1), r2 = ws.getCell(2,1), r3 = ws.getCell(3,1);
    r1.value = 'C L I P E N C Y';
    r1.font = {name:'Georgia', size:16, bold:true, color:{argb:CREAM}};
    r2.value = title;
    r2.font = {name:'Georgia', size:13, italic:true, color:{argb:GOLD}};
    r3.value = sub;
    r3.font = {name:'Calibri', size:9, color:{argb:'FFB8B2A8'}};
    for(var r=1;r<=3;r++) for(var c=1;c<=span;c++){
      ws.getCell(r,c).fill = {type:'pattern', pattern:'solid', fgColor:{argb:INK}};
      ws.getCell(r,c).alignment = {horizontal:'center', vertical:'middle'};
    }
    ws.getRow(1).height = 26; ws.getRow(2).height = 20; ws.getRow(3).height = 16;
    ws.getRow(4).height = 8;
  }

  function sectionLabel(ws, row, span, text){
    ws.mergeCells(row,1,row,span);
    var c = ws.getCell(row,1);
    c.value = text.toUpperCase();
    c.font = {name:'Calibri', size:9, bold:true, color:{argb:BRONZE}};
    c.alignment = {horizontal:'left'};
    ws.getRow(row).height = 18;
  }

  function tableHeader(ws, row, labels){
    labels.forEach(function(l, i){
      var c = ws.getCell(row, i+1);
      c.value = l;
      c.font = {name:'Calibri', size:9.5, bold:true, color:{argb:CREAM}};
      c.fill = {type:'pattern', pattern:'solid', fgColor:{argb:INK}};
      c.alignment = {horizontal: i === 0 ? 'left' : 'right', vertical:'middle'};
      c.border = boxBorder();
    });
    ws.getRow(row).height = 20;
  }

  function zebra(ws, row, vals, opts){
    opts = opts || {};
    vals.forEach(function(v, i){
      var c = ws.getCell(row, i+1);
      c.value = v;
      c.font = {name:'Calibri', size:10, color:{argb:'FF2B2824'}};
      c.fill = {type:'pattern', pattern:'solid', fgColor:{argb: row % 2 ? SOFT : PAPER}};
      c.alignment = {horizontal: i === 0 ? 'left' : 'right'};
      c.border = boxBorder();
      if(opts.fmt && opts.fmt[i]) c.numFmt = opts.fmt[i];
    });
  }

  function totalRow(ws, row, vals, fmt){
    vals.forEach(function(v, i){
      var c = ws.getCell(row, i+1);
      c.value = v;
      c.font = {name:'Calibri', size:10.5, bold:true, color:{argb:INK}};
      c.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FFEDE4D6'}};
      c.alignment = {horizontal: i === 0 ? 'left' : 'right'};
      c.border = {top:{style:'medium', color:{argb:GOLD}}, bottom:{style:'medium', color:{argb:GOLD}}, left:hair(), right:hair()};
      if(fmt && fmt[i]) c.numFmt = fmt[i];
    });
    ws.getRow(row).height = 22;
  }

  function kv(ws, row, label, value, fmtStr, accent){
    var l = ws.getCell(row,1), sp = ws.getCell(row,2), v = ws.getCell(row,3);
    ws.mergeCells(row,1,row,2);
    l.value = label;
    l.font = {name:'Calibri', size:10.5, color:{argb:'FF6B6560'}};
    v.value = value;
    v.font = {name:'Georgia', size:12, bold:true, color:{argb: accent || INK}};
    v.alignment = {horizontal:'right'};
    if(fmtStr) v.numFmt = fmtStr;
    [l, sp, v].forEach(function(c){
      c.fill = {type:'pattern', pattern:'solid', fgColor:{argb:SOFT}};
      c.border = {bottom:hair()};
    });
    ws.getRow(row).height = 21;
  }

  /* Excel money format in the currency the report is shown in (the active
     campaign's display currency), so a rupee campaign never exports with $. */
  function MF(){
    var C = window.CLIPENCY || {campaign:{}};
    var code = (C.campaign && C.campaign.currency) || 'USD';
    var X = window.CXCUR, cu = X && X.info(code);
    if(!cu) return '"$"#,##0.00';
    return '"' + cu.s + '"#,##0' + (cu.dp ? '.' + new Array(cu.dp + 1).join('0') : '');
  }
  function cap(s){ return s.charAt(0).toUpperCase() + s.slice(1); }

  async function build(){
    var C = window.CLIPENCY, T = C.totals();
    var camp = C.campaign;
    var db = window.CLIPDB;
    var today = db ? db.TODAY : '2026-07-20';
    var wb = new ExcelJS.Workbook();
    wb.creator = 'Clipency';
    wb.created = new Date();

    /* ============ 1 · SUMMARY ============ */
    var ws = sheetShell(wb, 'Summary', [
      {width:30},{width:6},{width:20},{width:4},{width:26},{width:16}
    ]);
    brandBand(ws, 6, camp.client + ' — Campaign Report',
      'Performance-based distribution · ' + (camp.start || '—') + ' → ' + today + ' · Generated ' + today);

    var r = 5;
    sectionLabel(ws, r++, 6, 'Campaign at a glance');
    kv(ws, r++, 'Views delivered (billable)', T.approvedViews, '#,##0');
    kv(ws, r++, 'Live clips', T.approvedCount, '#,##0');
    kv(ws, r++, 'Total likes', T.likes, '#,##0');
    kv(ws, r++, 'Total comments', T.comments, '#,##0');
    kv(ws, r++, 'Engagement', T.likes + T.comments, '#,##0');
    /* The export is a document the client keeps, so it must not price a
       per-video campaign by the view — that reported $0 on every row.
       Per-clip amounts come from the server already priced. */
    var PV = camp.payoutModel === 'per_video';
    kv(ws, r++, PV ? 'Rate (per approved video)' : 'Rate (per 1,000 views)',
       PV ? (camp.ratePerVideo || 0) : camp.cpm, MF());
    r++;
    sectionLabel(ws, r++, 6, 'Budget');
    kv(ws, r++, 'Campaign budget', T.budget, MF());
    kv(ws, r++, 'Spend to date', T.spend, MF());
    kv(ws, r++, 'Remaining budget', T.budget - T.spend, MF(), OK);
    kv(ws, r++, 'Budget exhausted', T.budgetUsed / 100, '0.0%', T.budgetUsed >= 85 ? BAD : BRONZE);
    r++;
    sectionLabel(ws, r++, 6, 'Platform split');
    var plats = C.byPlatform();
    tableHeader(ws, r++, ['Platform', '', 'Clips', '', 'Views', 'Share']);
    var pStart = r;
    plats.forEach(function(p){
      zebra(ws, r++, [cap(p.platform), '', p.clips, '', p.views, p.views / (T.approvedViews || 1)],
        {fmt:{2:'#,##0', 4:'#,##0', 5:'0.0%'}});
    });
    totalRow(ws, r++, ['All platforms', '', T.approvedCount, '', T.approvedViews, 1], {2:'#,##0', 4:'#,##0', 5:'0.0%'});
    r++;
    sectionLabel(ws, r++, 6, 'Top clips');
    tableHeader(ws, r++, ['Clip', '', 'Creator', '', 'Platform', 'Views']);
    C.top(5).forEach(function(t){
      zebra(ws, r++, [t.title, '', t.creator, '', cap(t.platform), t.views], {fmt:{5:'#,##0'}});
    });
    r++;
    ws.mergeCells(r,1,r,6);
    var foot = ws.getCell(r,1);
    foot.value = 'CLIPENCY · ' + camp.label + ' · billed at ' +
      (PV ? C.money(camp.ratePerVideo || 0) + ' per approved video'
          : C.money(camp.cpm) + ' per 1,000 delivered views');
    foot.font = {name:'Calibri', size:8.5, italic:true, color:{argb:'FF9B948A'}};
    foot.alignment = {horizontal:'center'};

    /* ============ 2 · CLIPS ============ */
    var wc = sheetShell(wb, 'Clips', [
      {width:34},{width:16},{width:13},{width:11},{width:9},{width:11},{width:12},{width:12},{width:42}
    ]);
    brandBand(wc, 9, 'All Live Clips — ' + camp.client, T.approvedCount + ' clips · sorted by views · ' + today);
    var rows = C.approved().slice().sort(function(a,b){ return b.views - a.views; });
    tableHeader(wc, 5, ['Clip title','Creator','Platform','Views','Likes','Comments','Posted','Earned','Link']);
    var cr = 6;
    rows.forEach(function(x){
      zebra(wc, cr, [x.title, x.creator, cap(x.platform), x.views, x.likes, x.comments, x.submitted, (x.amount||0), x.url],
        {fmt:{3:'#,##0', 4:'#,##0', 5:'#,##0', 7:MF()}});
      var link = wc.getCell(cr, 9);
      link.value = {text:'Open post', hyperlink:x.url};
      link.font = {name:'Calibri', size:10, color:{argb:BRONZE}, underline:true};
      cr++;
    });
    totalRow(wc, cr, ['Total — ' + rows.length + ' clips', '', '', T.approvedViews, T.likes, T.comments, '', T.spend, ''],
      {3:'#,##0', 4:'#,##0', 5:'#,##0', 7:MF()});
    wc.autoFilter = {from:{row:5, column:1}, to:{row:cr-1, column:9}};
    wc.views = [{showGridLines:false, state:'frozen', ySplit:5}];

    /* ============ 3 · CREATORS ============ */
    var wr = sheetShell(wb, 'Creators', [
      {width:22},{width:11},{width:14},{width:14},{width:11},{width:13},{width:12}
    ]);
    var creators = C.byCreator();
    brandBand(wr, 7, 'Creator Roster — ' + camp.client, creators.length + ' active creators · ranked by views delivered');
    tableHeader(wr, 5, ['Creator','Clips','Views','Avg / clip','Likes','Eng. rate','Earned']);
    var rr = 6;
    creators.forEach(function(cx){
      var eng = cx.views ? (cx.likes + cx.comments) / cx.views : 0;
      zebra(wr, rr++, [cx.creator, cx.clips, cx.views, Math.round(cx.views/(cx.clips||1)), cx.likes, eng, (cx.spend||0)],
        {fmt:{1:'#,##0', 2:'#,##0', 3:'#,##0', 4:'#,##0', 5:'0.0%', 6:MF()}});
    });
    totalRow(wr, rr, ['All creators', T.approvedCount, T.approvedViews, Math.round(T.approvedViews/(T.approvedCount||1)), T.likes, (T.likes+T.comments)/(T.approvedViews||1), T.spend],
      {1:'#,##0', 2:'#,##0', 3:'#,##0', 4:'#,##0', 5:'0.0%', 6:MF()});
    wr.views = [{showGridLines:false, state:'frozen', ySplit:5}];

    /* ============ 4 · BILLING ============ */
    var wbill = sheetShell(wb, 'Billing', [
      {width:34},{width:16},{width:13},{width:13},{width:13}
    ]);
    brandBand(wbill, 5, 'Spend & Billing — ' + camp.client,
      'Billed at ' + (PV ? C.money(camp.ratePerVideo || 0) + ' per approved video'
                         : C.money(camp.cpm) + ' per 1,000 delivered views') + ' · pay only for performance');
    tableHeader(wbill, 5, ['Clip','Creator','Posted','Billable views','Amount']);
    var br = 6;
    C.approved().slice().sort(function(a,b){ return a.submitted.localeCompare(b.submitted); }).forEach(function(x){
      zebra(wbill, br++, [x.title, x.creator, x.submitted, x.views, (x.amount||0)],
        {fmt:{3:'#,##0', 4:MF()}});
    });
    totalRow(wbill, br++, ['Total spend', '', '', T.approvedViews, T.spend], {3:'#,##0', 4:MF()});
    br++;
    kv(wbill, br++, 'Campaign budget', T.budget, MF());
    kv(wbill, br++, 'Budget exhausted', T.budgetUsed/100, '0.0%', BRONZE);
    kv(wbill, br++, 'Remaining', T.budget - T.spend, MF(), OK);
    wbill.views = [{showGridLines:false, state:'frozen', ySplit:5}];

    return wb;
  }

  async function download(){
    await loadLib();
    var wb = await build();
    var buf = await wb.xlsx.writeBuffer();
    var code = (window.CLIPENCY && CLIPENCY.campaign.code) || 'CP';
    var blob = new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Clipency_' + code + '_Campaign_Report.xlsx';
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  return {download:download, build:build};
})();
