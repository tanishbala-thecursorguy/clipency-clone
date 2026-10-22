
/* Last-resort reporter: without this, a syntax or load error anywhere leaves a
   blank page and no way to tell what happened without opening devtools. */
(function(){
  function paint(what, detail){
    if(document.body && document.body.dataset.cxFatal) return;
    if(document.body) document.body.dataset.cxFatal='1';
    var box=document.createElement('div');
    box.style.cssText='position:fixed;inset:0;z-index:99999;background:#0A0908;color:#F5F0EB;'+
      'font-family:-apple-system,sans-serif;padding:40px;overflow:auto';
    box.innerHTML='<div style="max-width:640px;margin:0 auto">'+
      '<div style="color:#F87171;font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px">Admin OS · '+what+'</div>'+
      '<h2 style="font-size:22px;margin-bottom:12px;font-weight:600">This page failed to load.</h2>'+
      '<pre style="background:rgba(255,255,255,.05);padding:14px;border-radius:10px;font-size:11.5px;'+
      'line-height:1.6;white-space:pre-wrap;color:rgba(245,240,235,.75)">'+String(detail).slice(0,1200)+'</pre>'+
      '<p style="margin-top:16px"><a href="/admin" style="color:#C4956A">← Back to Command Center</a></p></div>';
    (document.body||document.documentElement).appendChild(box);
  }
  window.addEventListener('error', function(e){
    paint('Script error', (e.error&&e.error.stack)||e.message||'unknown');
  });
  window.addEventListener('unhandledrejection', function(e){
    var r=e.reason; paint('Unhandled promise', (r&&r.stack)||(r&&r.message)||String(r));
  });
})();
// Block legacy admin scripts that conflict
window.__clipencyAdminLaunchBlocked = true;
window.reviews = ()=>{};
window.accounts = ()=>{};
window.campaigns_legacy = ()=>{};
window.payouts = ()=>{};
window.submissions = ()=>{};
window.leads = ()=>{};

(function(){
'use strict';
if(window.__clipencyAdminOSLoaded&&document.getElementById('cxos'))return;
window.__clipencyAdminOSLoaded=true;

const PATH=window.location.pathname;
/* Gate: the script exits immediately on any path not listed here. A new page
   needs THREE things — an entry in NAV, a branch in renderRouteInner(), and
   its path in this array. Miss this one and the page is simply blank, with
   no error anywhere, because nothing below ever executes. */
const ADMIN_PATHS=['/admin','/admin/reviews','/admin/review','/admin/logs','/admin/analytics','/admin/campaigns','/admin/leads',
  '/admin/payouts','/admin/users','/admin/accounts','/admin/connected-accounts','/admin/clients','/workspace'];
if(!ADMIN_PATHS.includes(PATH))return;

/* ══ CSS ══════════════════════════════════════════════════════════════════ */
const STYLE=`
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body.cxon{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Arial,sans-serif;background:#000;color:#f5f5f7;height:100vh;overflow:hidden}
body.cxon>*:not(#cxos):not(.cx-loader):not(.cx-overlay):not(.cx-panel){display:none!important}
#cxos{display:flex;height:100vh;overflow:hidden}
.cx-side{width:232px;flex-shrink:0;background:rgba(255,255,255,.03);border-right:1px solid rgba(255,255,255,.07);display:flex;flex-direction:column;overflow-y:auto}
.cx-brand{padding:22px 20px 18px;display:flex;align-items:center;gap:10px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.07)}
.cx-brand img{height:22px;width:auto}
.cx-brand span{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.28)}
.cx-ng{padding:14px 10px 0}
.cx-nl{font-size:10px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:rgba(255,255,255,.25);padding:0 8px 6px}
.cx-nav a{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:8px;color:rgba(255,255,255,.55);text-decoration:none;font-size:13.5px;font-weight:500;transition:all .15s;margin-bottom:1px}
.cx-nav a:hover{background:rgba(255,255,255,.07);color:#f5f5f7}
.cx-nav a.active{background:rgba(99,102,241,.18);color:#a5b4fc}
.cx-nav a svg{width:15px;height:15px;flex-shrink:0;opacity:.7}
.cx-nav a.active svg{opacity:1}
.cx-spacer{flex:1}
.cx-user{padding:12px;border-top:1px solid rgba(255,255,255,.07)}
.cx-uc{display:flex;align-items:center;gap:9px;padding:10px;border-radius:10px;background:rgba(255,255,255,.04)}
.cx-av{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0}
.cx-ui{flex:1;min-width:0}
.cx-un{font-size:12px;font-weight:600;color:#f5f5f7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cx-ur{font-size:10px;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.05em}
.cx-out{background:none;border:none;color:rgba(255,255,255,.28);cursor:pointer;font-size:14px;padding:3px 5px;border-radius:4px;transition:color .15s}
.cx-out:hover{color:#f87171}
.cx-main{flex:1;overflow-y:auto;background:#000}
.cx-wrap{max-width:1020px;padding:40px 44px 80px}
.cx-kicker{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6366f1;margin-bottom:8px}
.cx-h1{font-size:38px;font-weight:700;letter-spacing:-.02em;line-height:1.05;margin-bottom:8px}
.cx-sub{font-size:15px;color:rgba(255,255,255,.45);line-height:1.6;margin-bottom:32px;max-width:520px}
.cx-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:10px;margin-bottom:36px}
.cx-stat{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:18px;transition:all .2s;cursor:default}
.cx-stat:hover{background:rgba(255,255,255,.065);transform:translateY(-1px)}
.cx-stat-l{font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:rgba(255,255,255,.38);margin-bottom:8px}
.cx-stat-v{font-size:32px;font-weight:700;letter-spacing:-.02em;line-height:1}
.cx-stat-s{font-size:11px;color:rgba(255,255,255,.3);margin-top:4px}
.cx-stat.warn .cx-stat-v{color:#fbbf24}
.cx-stat.ok .cx-stat-v{color:#4ade80}
.cx-stat.info .cx-stat-v{color:#a5b4fc}
.cx-sec{margin-bottom:32px}
.cx-sh{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:12px;flex-wrap:wrap}
.cx-st{font-size:16px;font-weight:600;margin-bottom:2px}
.cx-sd{font-size:12px;color:rgba(255,255,255,.38)}
.cx-tabs{display:flex;gap:4px;margin-bottom:14px}
.cx-tab{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:7px;padding:6px 14px;font-size:12.5px;font-weight:600;color:rgba(255,255,255,.5);cursor:pointer;transition:all .15s;font-family:inherit}
.cx-tab:hover{background:rgba(255,255,255,.1);color:#f5f5f7}
.cx-tab.on{background:rgba(99,102,241,.2);border-color:rgba(99,102,241,.4);color:#a5b4fc}
.cx-tw{border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow-x:auto;-webkit-overflow-scrolling:touch}
table.cx-t{width:100%;min-width:820px;border-collapse:collapse;font-size:13px}
table.cx-t th:last-child,table.cx-t td:last-child{position:sticky;right:0;background:#0a0a0c;box-shadow:-10px 0 14px -8px rgba(0,0,0,.55)}
table.cx-t thead th:last-child{background:#0d0d0f}
table.cx-t th{background:rgba(255,255,255,.035);padding:9px 14px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:rgba(255,255,255,.3);border-bottom:1px solid rgba(255,255,255,.06)}
table.cx-t td{padding:11px 14px;border-bottom:1px solid rgba(255,255,255,.04);color:rgba(255,255,255,.75);vertical-align:middle}
table.cx-t tr:last-child td{border-bottom:none}
table.cx-t tr:hover td{background:rgba(255,255,255,.02)}
.cx-badge{display:inline-flex;align-items:center;padding:3px 9px;border-radius:20px;font-size:10.5px;font-weight:700;letter-spacing:.03em}
.cx-badge.pending{background:rgba(245,158,11,.13);color:#fbbf24}
.cx-badge.approved,.cx-badge.verified,.cx-badge.active,.cx-badge.paid{background:rgba(34,197,94,.13);color:#4ade80}
.cx-badge.rejected{background:rgba(239,68,68,.13);color:#f87171}
.cx-badge.draft{background:rgba(255,255,255,.08);color:rgba(255,255,255,.4)}
.cx-badge.paused{background:rgba(245,158,11,.1);color:#fb923c}
.cx-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer;border:none;text-decoration:none;transition:all .15s;font-family:inherit;white-space:nowrap}
.cx-btn:disabled{opacity:.4;cursor:not-allowed}
.cx-btn.pri{background:#6366f1;color:#fff}
.cx-btn.pri:hover:not(:disabled){background:#4f46e5}
.cx-btn.ghost{background:rgba(255,255,255,.07);color:rgba(255,255,255,.8);border:1px solid rgba(255,255,255,.1)}
.cx-btn.ghost:hover:not(:disabled){background:rgba(255,255,255,.12)}
.cx-btn.ok{background:rgba(34,197,94,.12);color:#4ade80;border:1px solid rgba(34,197,94,.2)}
.cx-btn.ok:hover:not(:disabled){background:rgba(34,197,94,.2)}
.cx-btn.danger{background:rgba(239,68,68,.12);color:#f87171;border:1px solid rgba(239,68,68,.2)}
.cx-btn.danger:hover:not(:disabled){background:rgba(239,68,68,.2)}
.cx-btn.sm{padding:5px 10px;font-size:11.5px}
.cx-btns{display:flex;gap:6px;flex-wrap:wrap}
.cx-empty{padding:44px 24px;text-align:center;color:rgba(255,255,255,.28);font-size:13.5px}
.cx-loader{position:fixed;inset:0;background:#000;display:flex;align-items:center;justify-content:center;z-index:99999}
.cx-spinner{width:26px;height:26px;border:2px solid rgba(255,255,255,.1);border-top-color:#6366f1;border-radius:50%;animation:cxspin .7s linear infinite}
@keyframes cxspin{to{transform:rotate(360deg)}}
/* Modal */
.cx-overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(4px);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px}
.cx-modal{background:#111;border:1px solid rgba(255,255,255,.12);border-radius:16px;width:100%;max-width:480px;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.6)}
.cx-modal h3{font-size:18px;font-weight:700;margin-bottom:6px}
.cx-modal p{font-size:13px;color:rgba(255,255,255,.5);margin-bottom:20px;line-height:1.6}
.cx-modal label{display:block;font-size:11.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:rgba(255,255,255,.4);margin-bottom:6px}
.cx-input,.cx-select,.cx-textarea{width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#f5f5f7;font-size:13.5px;padding:9px 13px;outline:none;transition:border-color .15s;font-family:inherit;margin-bottom:14px}
.cx-input:focus,.cx-select:focus,.cx-textarea:focus{border-color:#6366f1}
.cx-input::placeholder,.cx-textarea::placeholder{color:rgba(255,255,255,.22)}
.cx-select option{background:#1c1c1e}
.cx-textarea{resize:vertical;min-height:80px}
.cx-mf{display:flex;gap:8px;justify-content:flex-end;margin-top:6px}
/* Campaign form panel */
.cx-panel{position:fixed;inset:0;background:#000;z-index:8000;overflow-y:auto;padding:40px}
.cx-panel-head{max-width:700px;margin:0 auto 28px;display:flex;align-items:center;justify-content:space-between}
.cx-panel-head h2{font-size:24px;font-weight:700}
.cx-form-grid{max-width:700px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:14px}
.cx-form-grid .full{grid-column:1/-1}
.cx-fl{font-size:11.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:rgba(255,255,255,.4);margin-bottom:6px;display:block}
.cx-banner-drop{width:100%;aspect-ratio:16/5;border:2px dashed rgba(255,255,255,.15);border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;position:relative;overflow:hidden;background:rgba(255,255,255,.03)}
.cx-banner-drop:hover{border-color:rgba(99,102,241,.5);background:rgba(99,102,241,.05)}
.cx-banner-drop img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:10px}
.cx-banner-drop input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}
.cx-banner-label{font-size:13px;color:rgba(255,255,255,.4);pointer-events:none;z-index:1;text-align:center;line-height:1.8}
/* Inline alert */
.cx-alert{padding:12px 16px;border-radius:8px;font-size:13px;margin-bottom:14px;line-height:1.5}
.cx-alert.err{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);color:#f87171}
.cx-alert.suc{background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.2);color:#4ade80}
.cx-code-box{background:rgba(99,102,241,.12);border:1px solid rgba(99,102,241,.3);border-radius:10px;padding:16px;text-align:center;margin-bottom:14px}
.cx-code-box .code{font-size:36px;font-weight:800;letter-spacing:.25em;color:#a5b4fc;font-family:monospace}
.cx-code-box small{font-size:11.5px;color:rgba(255,255,255,.4);display:block;margin-top:4px}
/* -- ANIMATIONS -- */
@keyframes cxFadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes cxFadeIn{from{opacity:0}to{opacity:1}}
@keyframes cxScaleUp{from{opacity:0;transform:scale(.93)}to{opacity:1;transform:scale(1)}}
@keyframes cxSlideToast{from{opacity:0;transform:translateX(110%)}to{opacity:1;transform:translateX(0)}}
@keyframes cxRowIn{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}
@keyframes cxPulse{0%,100%{opacity:1}50%{opacity:.7}}
.cx-wrap{animation:cxFadeUp .38s cubic-bezier(.4,0,.2,1) both}
.cx-kicker{animation:cxFadeUp .32s ease both}
.cx-h1{animation:cxFadeUp .38s cubic-bezier(.4,0,.2,1) .04s both}
.cx-sub{animation:cxFadeUp .38s cubic-bezier(.4,0,.2,1) .08s both}
.cx-stat{animation:cxFadeUp .48s cubic-bezier(.34,1.1,.64,1) both;position:relative;overflow:hidden;transition:transform .25s cubic-bezier(.4,0,.2,1),background .2s,box-shadow .25s!important}
.cx-stat:nth-child(1){animation-delay:.04s}.cx-stat:nth-child(2){animation-delay:.08s}
.cx-stat:nth-child(3){animation-delay:.12s}.cx-stat:nth-child(4){animation-delay:.16s}
.cx-stat:nth-child(5){animation-delay:.20s}.cx-stat:nth-child(6){animation-delay:.24s}
.cx-stat:nth-child(7){animation-delay:.28s}.cx-stat:nth-child(8){animation-delay:.32s}
.cx-stat:nth-child(n+9){animation-delay:.36s}
.cx-stat:hover{background:rgba(255,255,255,.07)!important;transform:translateY(-3px) scale(1.015)!important;box-shadow:0 10px 32px rgba(0,0,0,.5),0 0 0 1px rgba(99,102,241,.15)!important}
.cx-stat.ok:hover{box-shadow:0 10px 32px rgba(0,0,0,.5),0 0 0 1px rgba(74,222,128,.2)!important}
.cx-stat.warn:hover{box-shadow:0 10px 32px rgba(0,0,0,.5),0 0 0 1px rgba(251,191,36,.2)!important}
.cx-stat.info:hover{box-shadow:0 10px 32px rgba(0,0,0,.5),0 0 0 1px rgba(165,180,252,.2)!important}
.cx-stat-v{transition:transform .2s cubic-bezier(.34,1.5,.64,1)}.cx-stat:hover .cx-stat-v{transform:scale(1.05)}
.cx-nav a{position:relative;overflow:hidden;transition:all .2s cubic-bezier(.4,0,.2,1)}
.cx-nav a::after{content:'';position:absolute;left:0;top:50%;width:3px;height:0;background:linear-gradient(180deg,#6366f1,#8b5cf6);border-radius:0 3px 3px 0;transform:translateY(-50%);transition:height .22s cubic-bezier(.4,0,.2,1)}
.cx-nav a.active::after{height:65%}
.cx-nav a svg{transition:transform .2s cubic-bezier(.34,1.5,.64,1)}.cx-nav a:hover svg{transform:scale(1.12)}
table.cx-t tbody tr{animation:cxRowIn .3s cubic-bezier(.4,0,.2,1) both;transition:background .15s}
table.cx-t tbody tr:nth-child(1){animation-delay:.03s}table.cx-t tbody tr:nth-child(2){animation-delay:.06s}
table.cx-t tbody tr:nth-child(3){animation-delay:.09s}table.cx-t tbody tr:nth-child(4){animation-delay:.12s}
table.cx-t tbody tr:nth-child(5){animation-delay:.15s}table.cx-t tbody tr:nth-child(6){animation-delay:.18s}
table.cx-t tbody tr:nth-child(n+7){animation-delay:.21s}
table.cx-t tr:hover td{background:rgba(99,102,241,.04)!important}
.cx-tw{box-shadow:0 2px 24px rgba(0,0,0,.3);transition:box-shadow .3s}.cx-tw:hover{box-shadow:0 6px 44px rgba(0,0,0,.45)}
.cx-badge{transition:all .2s;letter-spacing:.04em}
.cx-badge.approved,.cx-badge.verified,.cx-badge.active,.cx-badge.paid{box-shadow:0 0 10px rgba(74,222,128,.22)}
.cx-badge.pending{box-shadow:0 0 10px rgba(251,191,36,.22);animation:cxPulse 2.8s ease-in-out infinite}
.cx-badge.rejected{box-shadow:0 0 10px rgba(248,113,113,.22)}
.cx-btn{position:relative;overflow:hidden;transition:all .18s cubic-bezier(.4,0,.2,1)}
.cx-btn:active:not(:disabled){transform:scale(.97)!important}
.cx-btn.pri:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 20px rgba(99,102,241,.38)}
.cx-btn.ok:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 20px rgba(74,222,128,.28)}
.cx-btn.danger:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 20px rgba(248,113,113,.28)}
.cx-btn.ghost:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 16px rgba(0,0,0,.3)}
.cx-overlay{animation:cxFadeIn .18s ease both}.cx-modal{animation:cxScaleUp .22s cubic-bezier(.34,1.1,.64,1) both}
.cx-input:focus,.cx-select:focus,.cx-textarea:focus{border-color:rgba(99,102,241,.7)!important;box-shadow:0 0 0 3px rgba(99,102,241,.14)!important}
.cx-main::-webkit-scrollbar{width:5px}.cx-main::-webkit-scrollbar-track{background:transparent}
.cx-main::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:10px}
.cx-side::-webkit-scrollbar{width:3px}.cx-side::-webkit-scrollbar-thumb{background:rgba(255,255,255,.06);border-radius:10px}
.cx-brand{transition:background .2s}.cx-brand:hover{background:rgba(255,255,255,.04)}
.cx-brand img{transition:transform .3s cubic-bezier(.34,1.5,.64,1)}.cx-brand:hover img{transform:scale(1.07)}
.cx-tab{transition:all .18s cubic-bezier(.4,0,.2,1)}.cx-tab:hover:not(.on){transform:translateY(-1px)}
.cx-sec{animation:cxFadeUp .38s cubic-bezier(.4,0,.2,1) .06s both}
.cx-st{font-size:17px;letter-spacing:-.015em}
#cx-toast-wrap{position:fixed;bottom:24px;right:24px;z-index:999999;display:flex;flex-direction:column-reverse;gap:8px;pointer-events:none;max-width:360px}
.cx-edited{display:inline-block;font-size:9.5px;font-weight:600;color:#60a5fa;background:rgba(96,165,250,.1);border:1px solid rgba(96,165,250,.2);padding:1px 6px;border-radius:4px;margin-top:3px}
.cx-log-who{font-size:11px;font-weight:700;letter-spacing:.04em}
.cx-log-what{font-size:12.5px;font-weight:600;color:#f5f5f7;line-height:1.4}
.cx-log-detail{font-size:11px;color:rgba(255,255,255,.4);margin-top:2px;line-height:1.5}
.cx-av{transition:transform .3s cubic-bezier(.34,1.5,.64,1)}.cx-uc:hover .cx-av{transform:scale(1.1)}
`;
const styleEl=document.createElement('style');
styleEl.textContent=STYLE;
document.head.appendChild(styleEl);

/* ══ ICONS ══════════════════════════════════════════════════════════════ */
const I={
  grid:'<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" stroke="currentColor" stroke-width="1.7" fill="none"/>',
  check:'<path d="M20 6 9 17l-5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  play:'<path d="M7 5v14l12-7-12-7Z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/>',
  mail:'<path d="M4 6h16v12H4z" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="m4 8 8 6 8-6" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/>',
  wallet:'<path d="M4 7h16v11H4z" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M16 12h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  users:'<path d="M16 21a5 5 0 0 0-10 0" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/><circle cx="11" cy="8" r="4" stroke="currentColor" stroke-width="1.7" fill="none"/>',
  link:'<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.5-1.5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  finance:'<path d="M5 19V5M5 19h14M9 16v-5M13 16V8M17 16v-7" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  ext:'<path d="M14 4h6v6M20 4l-9 9" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  x:'<path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  plus:'<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  edit:'<path d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M17.5 2.5a2.121 2.121 0 0 1 3 3L12 14l-4 1 1-4 8.5-8.5z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  logs:'<path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  chart:'<path d="M4 19V9M10 19V5M16 19v-7M22 19H2" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
};
const svg=n=>`<svg viewBox="0 0 24 24" fill="none">${I[n]||I.grid}</svg>`;

const NAV=[
  ['Command Center','/admin','grid'],
  ['Accounts','/admin/connected-accounts','link'],
  ['Campaigns','/admin/campaigns','play'],
  ['Reviews','/admin/reviews','check'],
  ['Leads','/admin/leads','mail'],
  ['Payouts','/admin/payouts','wallet'],
  ['Users','/admin/users','users'],
  ['Clients','/admin/clients','users'],
  ['Logs','/admin/logs','logs'],
  ['Analytics','/admin/analytics','chart'],
  ['Finance OS','https://finance.clipency.in','finance',true],
  ['Clipper View','/campaigns','ext',true],
];

const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const fmt=n=>n!=null?Number(n).toLocaleString('en-US'):'—';
const fmtDate=d=>d?new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'—';
const fmtMoney=n=>n!=null?'$'+fmt(n):'—';

/* ══ TOAST ═══════════════════════════════════════════════════════════════ */
function toast(msg,type='ok'){
  let tc=document.getElementById('cx-toast-wrap');
  if(!tc){tc=document.createElement('div');tc.id='cx-toast-wrap';tc.style.cssText='position:fixed;bottom:24px;right:24px;z-index:999999;display:flex;flex-direction:column-reverse;gap:8px;pointer-events:none;max-width:360px';document.body.appendChild(tc);}
  const cfg={ok:{bg:'rgba(34,197,94,.12)',bd:'rgba(74,222,128,.3)',col:'#4ade80'},err:{bg:'rgba(239,68,68,.12)',bd:'rgba(248,113,113,.3)',col:'#f87171'},info:{bg:'rgba(99,102,241,.12)',bd:'rgba(165,180,252,.3)',col:'#a5b4fc'}}[type]||{bg:'rgba(99,102,241,.12)',bd:'rgba(165,180,252,.3)',col:'#a5b4fc'};
  const t=document.createElement('div');
  t.style.cssText=`pointer-events:auto;padding:12px 18px;border-radius:12px;font-size:13.5px;font-weight:600;backdrop-filter:blur(16px);background:${cfg.bg};border:1px solid ${cfg.bd};color:${cfg.col};box-shadow:0 8px 32px rgba(0,0,0,.45);animation:cxSlideToast .3s cubic-bezier(.34,1.2,.64,1) both;max-width:360px;font-family:-apple-system,sans-serif;line-height:1.4;`;
  t.textContent=msg;tc.appendChild(t);
  setTimeout(()=>{t.style.opacity='0';t.style.transform='translateX(110%)';t.style.transition='all .3s ease';setTimeout(()=>t.remove(),300);},3200);
}

/* ══ STATE ══════════════════════════════════════════════════════════════ */
let sb=null,me=null,myRole='clipper';

async function wait(ms){return new Promise(r=>setTimeout(r,ms));}
async function getClient(){
  for(let i=0;i<80;i++){
    const c=window.clipencySupabase||window.supabaseClient||window.sbClient;
    if(c?.auth)return c;
    await wait(100);
  }
  throw new Error('Supabase client not available');
}

/* ══ AUTH ══════════════════════════════════════════════════════════════ */
async function initAuth(){
  sb=await getClient();
  const{data,error}=await sb.auth.getUser();
  if(error||!data?.user){window.location.replace('/login');return false;}
  me=data.user;
  let role='clipper';
  try{
    const{data:ac,error:acErr}=await sb.rpc('admin_access_check');
    if(!acErr&&ac?.role){role=ac.role;}else{throw new Error('rpc_failed:'+JSON.stringify(acErr));}
  }catch{
    try{
      const{data:rows}=await sb.from('admin_users').select('email').eq('email',me.email).limit(1);
      role=(rows||[]).length?'admin':'clipper';
    }catch{}
  }
  myRole=role;
  if(role!=='admin'&&role!=='reviewer'){
    document.body.className='';document.body.innerHTML=`<div style="min-height:100vh;display:grid;place-items:center;background:#000;color:#f5f5f7;font-family:-apple-system,sans-serif"><div style="text-align:center;max-width:440px;padding:32px"><div style="color:#6366f1;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:14px">Access Denied</div><h1 style="font-size:36px;font-weight:700;margin-bottom:10px">Admin only.</h1><p style="color:rgba(255,255,255,.5);margin-bottom:24px">You're signed in as <b>${esc(me.email)}</b> which is not an admin account.</p><a href="/login" style="background:#6366f1;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:600">Sign in as admin</a></div></div>`;
    return false;
  }
  return true;
}

/* ══ SHELL ══════════════════════════════════════════════════════════════ */
function shell(content){
  const email=me?.email||'';
  const name=me?.user_metadata?.full_name||email.split('@')[0]||'Admin';
  const init=name[0]?.toUpperCase()||'A';
  const REVIEWER_ALLOWED=['/admin/connected-accounts','/admin/accounts','/admin/reviews','/admin/review'];
  const navItems=myRole==='reviewer'?NAV.filter(([,href])=>REVIEWER_ALLOWED.includes(href)):NAV;
  const nav=navItems.map(([label,href,ic,ext])=>{
    const active=!ext&&(PATH===href||(href!=='/admin'&&PATH.startsWith(href)));
    return`<a href="${href}" class="${active?'active':''}" ${ext?'target="_blank" rel="noopener noreferrer"':''}>${svg(ic)}<span>${label}</span></a>`;
  }).join('');
  return`<div id="cxos"><aside class="cx-side">
    <div class="cx-brand" onclick="location.href='/admin'">
      <img src="/assets/clipency-logo.png" onerror="this.src='/clipency-logo.png'" alt="Clipency"/>
      <span>Admin OS</span>
    </div>
    <div class="cx-ng"><div class="cx-nl">Operations</div><nav class="cx-nav">${nav}</nav></div>
    <div class="cx-spacer"></div>
    <div class="cx-user"><div class="cx-uc">
      <div class="cx-av">${esc(init)}</div>
      <div class="cx-ui"><div class="cx-un">${esc(name)}</div><div class="cx-ur">Admin</div></div>
      <button class="cx-out" id="cx-logout" title="Sign out">↗</button>
    </div></div>
  </aside>
  <main class="cx-main"><div class="cx-wrap">${content}</div></main></div>`;
}

function page({kicker,title,sub,body}){
  return shell(`<div class="cx-kicker">${esc(kicker)}</div><h1 class="cx-h1">${esc(title)}</h1><p class="cx-sub">${esc(sub)}</p>${body||''}`);
}

/* ══ MODAL ══════════════════════════════════════════════════════════════ */
function showModal({title,desc,fields,confirmLabel,confirmClass,onConfirm}){
  return new Promise(resolve=>{
    const id='cxm'+Date.now();
    const fieldsHtml=(fields||[]).map(f=>{
      if(f.type==='textarea')return`<label>${esc(f.label)}</label><textarea class="cx-textarea" id="${id}_${f.key}" placeholder="${esc(f.placeholder||'')}" ${f.required?'required':''}></textarea>`;
      return`<label>${esc(f.label)}</label><input class="cx-input" id="${id}_${f.key}" type="${f.type||'text'}" placeholder="${esc(f.placeholder||'')}" min="${f.min||''}" step="${f.step||''}" ${f.required?'required':''}/>`;
    }).join('');
    const el=document.createElement('div');
    el.className='cx-overlay';
    el.innerHTML=`<div class="cx-modal">
      <h3>${esc(title)}</h3>${desc?`<p>${esc(desc)}</p>`:''}
      <div id="${id}_err"></div>
      ${fieldsHtml}
      <div class="cx-mf">
        <button class="cx-btn ghost" id="${id}_cancel">Cancel</button>
        <button class="cx-btn ${confirmClass||'pri'}" id="${id}_ok">${esc(confirmLabel||'Confirm')}</button>
      </div>
    </div>`;
    document.body.appendChild(el);
    const close=()=>document.body.removeChild(el);
    el.querySelector('#'+id+'_cancel').onclick=()=>{close();resolve(null);};
    el.querySelector('#'+id+'_ok').onclick=async()=>{
      const vals={};
      let ok=true;
      for(const f of fields||[]){
        const el2=document.getElementById(id+'_'+f.key);
        if(!el2)continue;
        const v=el2.value.trim();
        if(f.required&&!v){el2.focus();ok=false;break;}
        vals[f.key]=f.type==='number'?parseFloat(v):v;
      }
      if(!ok)return;
      const errEl=document.getElementById(id+'_err');
      try{
        el.querySelector('#'+id+'_ok').disabled=true;
        el.querySelector('#'+id+'_ok').textContent='Saving…';
        await onConfirm(vals);
        close();
        resolve(vals);
      }catch(e){
        errEl.innerHTML=`<div class="cx-alert err">${esc(e.message||'Error')}</div>`;
        el.querySelector('#'+id+'_ok').disabled=false;
        el.querySelector('#'+id+'_ok').textContent=confirmLabel||'Confirm';
      }
    };
  });
}

/* ══ COMMAND CENTER ══════════════════════════════════════════════════ */
async function renderCommand(){
  const{data:stats}=await sb.rpc('admin_get_stats');
  const s=stats||{};
  const cards=[
    ['Clippers',s.total_clippers||0,'Registered users','info'],
    ['Active Campaigns',s.active_campaigns||0,'Live now','ok'],
    ['Pending Reviews',s.pending_reviews||0,'Awaiting review','warn'],
    ['Pending Accounts',s.pending_accounts||0,'Awaiting verification','warn'],
    ['Pending Payouts',s.pending_payouts||0,'Withdrawal requests','warn'],
    ['Total Paid Out',fmtMoney(s.total_paid_out||0),'Processed','ok'],
    ['Total Approved',fmtMoney(s.total_earnings_approved||0),'Earned by clippers','info'],
    ['Rejected',s.rejected_submissions||0,'Clip rejections',''],
  ].map(([l,v,s2,cls])=>`<div class="cx-stat ${cls}"><div class="cx-stat-l">${l}</div><div class="cx-stat-v">${v}</div><div class="cx-stat-s">${s2}</div></div>`).join('');
  const quick=[
    ['/admin/connected-accounts','Pending Accounts','Verify clippers'],
    ['/admin/reviews','Review Queue','Approve clips'],
    ['/admin/campaigns','Campaigns','Manage active'],
    ['/admin/payouts','Payouts','Process withdrawals'],
    ['/admin/users','Users','Manage access'],
    ['https://finance.clipency.in','Finance OS','External',true],
  ].map(([href,l,d,ext])=>`<a href="${href}" style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px 16px;text-decoration:none;display:block;transition:all .15s" ${ext?'target="_blank" rel="noopener noreferrer"':''}
    onmouseover="this.style.background='rgba(255,255,255,.07)'" onmouseout="this.style.background='rgba(255,255,255,.04)'">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.3);margin-bottom:4px">${d}</div>
    <div style="font-size:18px;font-weight:700;color:#f5f5f7">${l} →</div>
  </a>`).join('');
  return page({kicker:'Command Center',title:'Platform operations.',sub:'Everything that keeps Clipency running.',
    body:`<div class="cx-stats">${cards}</div>
    <div class="cx-sec"><div class="cx-sh"><div><div class="cx-st">Quick access</div><div class="cx-sd">Jump to any section of the OS</div></div></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">${quick}</div></div>`});
}

/* ══ ACCOUNTS ════════════════════════════════════════════════════════ */
window.__acctFilter = function(){
  const p=new URLSearchParams(location.search);
  const q=(document.getElementById('cx-acct-search')?.value||'').trim();
  const from=document.getElementById('cx-acct-from')?.value||'';
  const to=document.getElementById('cx-acct-to')?.value||'';
  if(q)p.set('q',q);else p.delete('q');
  if(from)p.set('from',from);else p.delete('from');
  if(to)p.set('to',to);else p.delete('to');
  location.search='?'+p.toString();
};
window.__acctClear = function(){
  const p=new URLSearchParams(location.search);
  const tab=p.get('tab')||'pending';
  location.search='?tab='+tab;
};
async function renderAccounts(){
  const params=new URLSearchParams(location.search);
  const tab=params.get('tab')||'pending';
  const platform=params.get('platform')||'all';
  const q=(params.get('q')||'').trim().toLowerCase();
  const from=params.get('from')||'';
  const to=params.get('to')||'';
  // Direct query — avoids ambiguous status column in RPC
  const caQuery = await sb
    .from('connected_accounts')
    .select('id,user_id,platform,username,handle,verification_code,status,rejection_reason,created_at,expires_at,verified_at,is_verified,profiles(email,full_name)')
    .order('created_at',{ascending:false});
  const allRows = caQuery.error ? [] : (caQuery.data||[])
    .map(x=>({...x,acct_status:x.status,user_email:x.profiles?.email,user_name:x.profiles?.full_name}));
  let rows = tab==='all' ? allRows : allRows.filter(x=>x.status===tab);
  if(platform!=='all') rows = rows.filter(x=>(x.platform||'').toLowerCase()===platform);
  if(q) rows = rows.filter(x=>
    (x.user_email||'').toLowerCase().includes(q) ||
    (x.user_name||'').toLowerCase().includes(q) ||
    (x.handle||x.username||'').toLowerCase().includes(q)
  );
  if(from){ const fromTs=new Date(from+'T00:00:00').getTime(); rows = rows.filter(x=>new Date(x.created_at).getTime()>=fromTs); }
  if(to){ const toTs=new Date(to+'T23:59:59').getTime(); rows = rows.filter(x=>new Date(x.created_at).getTime()<=toTs); }

  const qs=(overrides)=>{
    const p=new URLSearchParams(location.search);
    Object.entries(overrides).forEach(([k,v])=>{ if(v===''||v==null)p.delete(k);else p.set(k,v); });
    return '?'+p.toString();
  };

  const tabs=['pending','verified','rejected','all'].map(t=>`<button class="cx-tab${tab===t?' on':''}" onclick="location.search='${qs({tab:t})}'">${t.charAt(0).toUpperCase()+t.slice(1)}</button>`).join('');
  const platformPills=['all','tiktok','instagram','youtube'].map(pl=>`<button class="cx-tab${platform===pl?' on':''}" onclick="location.search='${qs({platform:pl})}'">${pl==='all'?'All platforms':pl.charAt(0).toUpperCase()+pl.slice(1)}</button>`).join('');
  const platformIcon={youtube:'📹',instagram:'📸',tiktok:'🎵',yt:'📹',ig:'📸',tt:'🎵'};

  const filterBar=`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:14px 0">
    <div class="cx-tabs" style="margin:0">${platformPills}</div>
    <input type="text" id="cx-acct-search" placeholder="Search clipper email, name or handle…" value="${esc(q)}"
      style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:7px 12px;color:#f5f5f7;font-size:13px;min-width:240px"
      onkeydown="if(event.key==='Enter')window.__acctFilter()"/>
    <input type="date" id="cx-acct-from" value="${esc(from)}" title="From date"
      style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:6px 10px;color:#f5f5f7;font-size:13px"
      onchange="window.__acctFilter()"/>
    <span style="color:rgba(255,255,255,.3);font-size:12px">to</span>
    <input type="date" id="cx-acct-to" value="${esc(to)}" title="To date"
      style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:6px 10px;color:#f5f5f7;font-size:13px"
      onchange="window.__acctFilter()"/>
    <button class="cx-btn ghost sm" onclick="window.__acctFilter()">Apply</button>
    <button class="cx-btn ghost sm" onclick="window.__acctClear()">Clear filters</button>
  </div>`;

  const rowsHtml=(rows||[]).length?`<div class="cx-tw"><table class="cx-t">
    <thead><tr><th>Platform</th><th>Handle</th><th>Clipper</th><th>Code</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
    <tbody>${(rows||[]).map(r=>`<tr>
      <td>${platformIcon[r.platform?.toLowerCase()]||'🔗'} ${esc(r.platform||'—')}</td>
      <td><strong>@${esc(r.handle||r.username||'—')}</strong></td>
      <td><div style="font-size:12px">${esc(r.user_email||'—')}</div><div style="font-size:11px;color:rgba(255,255,255,.35)">${esc(r.user_name||'')}</div></td>
      <td>${r.status==='pending'?`<code style="background:rgba(99,102,241,.15);color:#a5b4fc;padding:3px 8px;border-radius:5px;font-family:monospace;font-size:13px;font-weight:700;letter-spacing:.1em">${esc(r.verification_code||'—')}</code>`:'<span style="color:rgba(255,255,255,.3)">—</span>'}</td>
      <td><span class="cx-badge ${r.status}">${esc(r.status||'—')}</span></td>
      <td style="font-size:11.5px;color:rgba(255,255,255,.4)">${fmtDate(r.created_at)}</td>
      <td><div class="cx-btns">
        ${r.status==='pending'?`
          <button class="cx-btn ok sm" data-approve-acct="${esc(r.id)}">Approve</button>
          <button class="cx-btn danger sm" data-reject-acct="${esc(r.id)}">Reject</button>
        `:r.status==='verified'?`
          <button class="cx-btn danger sm" data-reject-acct="${esc(r.id)}">Reject</button>
        `:r.status==='rejected'?`
          <button class="cx-btn ok sm" data-approve-acct="${esc(r.id)}">Approve</button>
        `:'<span style="font-size:11.5px;color:rgba(255,255,255,.3)">—</span>'}
      </div></td>
    </tr>`).join('')}</tbody>
  </table></div>`:`<div class="cx-empty">No accounts match these filters.</div>`;

  const subParts=[`${rows.length} account${rows.length!==1?'s':''}`];
  if(tab!=='all')subParts.push(`in ${tab}`);
  if(platform!=='all')subParts.push(`on ${platform}`);
  if(q)subParts.push(`matching "${esc(q)}"`);
  if(from||to)subParts.push(`between ${from||'…'} and ${to||'…'}`);

  return page({kicker:'Accounts',title:'Connected accounts.',sub:'Verify social media accounts connected by clippers. Check the verification code is in their bio.',
    body:`<div class="cx-sec"><div class="cx-sh"><div><div class="cx-st">Account verification</div><div class="cx-sd">${subParts.join(' · ')}</div></div></div>
    <div class="cx-tabs">${tabs}</div>${filterBar}${rowsHtml}</div>`});
}

/* ══ CAMPAIGNS ════════════════════════════════════════════════════════ */
async function renderCampaigns(){
  let rows=[];
  try{const r=await sb.from('campaigns').select('*').order('created_at',{ascending:false});rows=r.data||[];}catch(e){rows=[];}

  const STATUS_COLOR={active:'approved',draft:'draft',paused:'paused',ended:'inactive'};
  const PLAT_COLOR={youtube:'rgba(255,0,0,.15)',instagram:'rgba(225,48,108,.15)',tiktok:'rgba(255,255,255,.08)',all:'rgba(196,149,106,.1)'};
  const PLAT_TC={youtube:'#FF4444',instagram:'#E1306C',tiktok:'rgba(255,255,255,.8)',all:'#C4956A'};

  const cardsHtml = rows.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;margin-top:4px">
    ${rows.map(r=>{
      const plat=(r.platform||'All').toLowerCase();
      return`<div style="background:linear-gradient(135deg,rgba(24,20,16,.95),rgba(14,12,9,.8));border:1px solid rgba(196,149,106,.14);border-radius:16px;overflow:hidden;transition:all .2s;cursor:pointer" onmouseover="this.style.borderColor='rgba(196,149,106,.35)';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='rgba(196,149,106,.14)';this.style.transform='none'">
        <div style="position:relative;width:100%;height:120px;overflow:hidden;background:rgba(196,149,106,.04)">
  ${r.asset_url?`<img src="${esc(r.asset_url)}" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.style.background='transparent'"/>`:`<div style="width:100%;height:6px;background:linear-gradient(90deg,#C4956A,rgba(196,149,106,.3))"></div>`}
  ${r.icon_url?`<div style="position:absolute;bottom:8px;left:8px;width:38px;height:38px;border-radius:9px;overflow:hidden;border:2px solid rgba(0,0,0,.5);box-shadow:0 2px 10px rgba(0,0,0,.5)"><img src="${esc(r.icon_url)}" style="width:100%;height:100%;object-fit:cover"/></div>`:''}
</div>
        <div style="padding:16px 18px 18px">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px">
            <div>
              <div style="font-family:'Instrument Serif',serif;font-size:1.1rem;color:#F5F0EB;line-height:1.2;margin-bottom:4px">${esc(r.title||'—')}</div>
              ${r.brand_name?`<div style="font-size:.72rem;color:#6A6158">${esc(r.brand_name)}</div>`:''}
            </div>
            <span class="cx-badge ${STATUS_COLOR[r.status]||'draft'}" style="flex-shrink:0">${esc(r.status||'draft')}</span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
            <span style="background:${PLAT_COLOR[plat]||PLAT_COLOR.all};color:${PLAT_TC[plat]||PLAT_TC.all};padding:3px 10px;border-radius:20px;font-size:.7rem;font-weight:700;font-family:'Space Mono',monospace">${esc(r.platform||'All')}</span>
            ${r.genre||r.category?`<span style="background:rgba(196,149,106,.1);color:#C4956A;padding:3px 10px;border-radius:20px;font-size:.7rem;font-weight:600">${esc(r.genre||r.category)}</span>`:''}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
            <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:8px 10px">
              <div style="font-family:'Space Mono',monospace;font-size:.48rem;letter-spacing:.12em;text-transform:uppercase;color:#6A6158;margin-bottom:3px">RPM</div>
              <div style="font-size:.95rem;font-weight:700;color:#C4956A">${r.rpm?'$'+Number(r.rpm).toLocaleString('en-US'):'—'}</div>
            </div>
            <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:8px 10px">
              <div style="font-family:'Space Mono',monospace;font-size:.48rem;letter-spacing:.12em;text-transform:uppercase;color:#6A6158;margin-bottom:3px">Budget</div>
              <div style="font-size:.95rem;font-weight:700;color:#F5F0EB">${r.budget?'$'+Number(r.budget).toLocaleString('en-US'):'—'}</div>
            </div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="cx-btn pri" style="flex:1;justify-content:center;background:#C4956A;color:#0A0908;font-size:.76rem" onclick="window.__editCamp('${esc(r.id)}')">Edit Campaign</button>
            <button class="cx-btn ghost" style="font-size:.76rem;padding:6px 10px" onclick="toggleCampStatus('${esc(r.id)}','${esc(r.status)}')">${r.status==='active'?'Pause':'Activate'}</button>
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>` : `<div class="cx-empty" style="border:1px dashed rgba(196,149,106,.15);border-radius:14px">No campaigns yet. Create your first one.</div>`;

  return page({kicker:'Campaign Control',title:'Campaigns.',sub:'Create and manage campaigns. Upload banners, set rates and control visibility.',
    body:`<div class="cx-sec">
    <div class="cx-sh">
      <div>
        <div class="cx-st">All campaigns</div>
        <div class="cx-sd">${rows.length} total · ${rows.filter(r=>r.status==='active').length} active</div>
      </div>
      <button class="cx-btn pri" id="cx-new-campaign" style="background:#C4956A;color:#0A0908">${svg('plus')} New Campaign</button>
    </div>
    ${cardsHtml}</div>`});
}

window.__editCamp = async function(id){
  const{data}=await sb.from('campaigns').select('*').eq('id',id).maybeSingle();
  if(data)window.showCampaignForm(data);
};
window.editSub = async function(id, currentAmount, currentViews){
  const v=prompt('Views count:',currentViews||0);
  if(v===null)return;
  const a=prompt('Approved amount ($):',currentAmount||0);
  if(a===null)return;
  const{error}=await sb.rpc('admin_edit_submission',{p_id:id,p_amount:Number(a),p_views:Number(v)});
  if(error){alert(error.message);return;}
  toast('✓ Updated — reflects across all clipper pages');
  await boot();
};
window.toggleCampStatus = async function(id, currentStatus){
  const newStatus = currentStatus==='active'?'paused':'active';
  await sb.from('campaigns').update({status:newStatus}).eq('id',id);
  await boot();
}

window.showCampaignForm = async function showCampaignForm(existing=null){
  const c=existing||{};
  const selPlatforms = c.platforms||[c.platform||'All'];

  const panel=document.createElement('div');
  panel.className='cx-panel';
  panel.style.cssText='position:fixed;inset:0;background:#0A0908;z-index:8000;overflow-y:auto;padding:0';
  panel.innerHTML=`<div style="max-width:720px;margin:0 auto;padding:40px 32px 80px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:32px">
      <div>
        <div style="font-family:'Space Mono',monospace;font-size:.52rem;letter-spacing:.16em;text-transform:uppercase;color:#C4956A;margin-bottom:6px">${existing?'Edit Campaign':'New Campaign'}</div>
        <h2 style="font-family:'Instrument Serif',serif;font-size:1.8rem;color:#F5F0EB;font-weight:400">${existing?esc(c.title||''):'Create a new campaign'}</h2>
      </div>
      <button id="cp-close" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#B8AFA8;width:36px;height:36px;border-radius:8px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center">✕</button>
    </div>
    <div id="cp-err"></div>

    <!-- Banner + Icon -->
    <div style="display:grid;grid-template-columns:1fr 120px;gap:14px;margin-bottom:20px;align-items:start">
      <div>
        <label style="display:block;font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.12em;text-transform:uppercase;color:#6A6158;margin-bottom:8px">Campaign Banner</label>
        <div id="cp-banner-drop" style="width:100%;aspect-ratio:16/5;border:2px dashed rgba(196,149,106,.2);border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;position:relative;overflow:hidden;background:rgba(196,149,106,.03)">
          ${c.asset_url?`<img src="${esc(c.asset_url)}" id="cp-banner-preview" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">`:''}
          <input type="file" id="cp-banner-file" accept="image/*" style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%"/>
          <div id="cp-banner-label" style="font-size:.8rem;color:#6A6158;text-align:center;pointer-events:none;z-index:1;line-height:1.8${c.asset_url?';display:none':''}">🖼<br/>Click to upload<br/><span style="font-size:.68rem">1280×400px</span></div>
        </div>
      </div>
      <div>
        <label style="display:block;font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.12em;text-transform:uppercase;color:#6A6158;margin-bottom:8px">Campaign Icon</label>
        <div id="cp-icon-drop" style="width:100%;aspect-ratio:1/1;border:2px dashed rgba(196,149,106,.2);border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;position:relative;overflow:hidden;background:rgba(196,149,106,.03)">
          ${c.icon_url?`<img src="${esc(c.icon_url)}" id="cp-icon-preview" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">`:''}
          <input type="file" id="cp-icon-file" accept="image/*" style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%"/>
          <div id="cp-icon-label" style="font-size:.72rem;color:#6A6158;text-align:center;pointer-events:none;z-index:1;line-height:2${c.icon_url?';display:none':''}">🎨<br/><span style="font-size:.62rem">Icon<br/>200×200px</span></div>
        </div>
        ${c.icon_url?`<button type="button" id="cp-icon-clear" style="width:100%;margin-top:5px;padding:4px;border-radius:6px;border:1px solid rgba(248,113,113,.3);background:rgba(248,113,113,.06);color:rgba(248,113,113,.7);font-size:.65rem;cursor:pointer;font-family:'DM Sans',sans-serif">✕ Remove icon</button>`:''}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:6px">
      <div style="grid-column:1/-1">
        <label style="display:block;font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.12em;text-transform:uppercase;color:#6A6158;margin-bottom:6px">Campaign Title *</label>
        <input id="cp-title" class="cx-input" value="${esc(c.title||'')}" placeholder="e.g. La Isla Bonita · Summer 2026" style="width:100%"/>
      </div>
      <div>
        <label style="display:block;font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.12em;text-transform:uppercase;color:#6A6158;margin-bottom:6px">Brand Name</label>
        <input id="cp-brand" class="cx-input" value="${esc(c.brand_name||'')}" placeholder="Client or brand" style="width:100%"/>
      </div>
      <div style="grid-column:1/-1">
        <label style="display:block;font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.12em;text-transform:uppercase;color:#6A6158;margin-bottom:6px">Client Dashboard Access</label>
        <select id="cp-client" class="cx-select" style="width:100%">
          <option value="">Not connected — nobody can see this campaign</option>
        </select>
        <div style="font-size:.72rem;color:#6A6158;margin-top:6px;line-height:1.55">
          The client account that sees this campaign's clips, views and spend on their own dashboard.
          Create accounts under <a href="/admin/clients" style="color:#C4956A">Clients</a>.
        </div>
      </div>
      <div>
        <label style="display:block;font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.12em;text-transform:uppercase;color:#6A6158;margin-bottom:6px">Category</label>
        <select id="cp-genre" class="cx-select" style="width:100%">
          ${['Music','Gaming','UGC','Sports','Clipping','Edits','Finance','Other'].map(g=>`<option value="${g}" ${(c.genre||c.category||'Music')===g?'selected':''}>${g}</option>`).join('')}
        </select>
      </div>
      <div>
        <label style="display:block;font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.12em;text-transform:uppercase;color:#6A6158;margin-bottom:6px">Status</label>
        <select id="cp-status" class="cx-select" style="width:100%">
          ${['draft','active','paused','ended'].map(s=>`<option value="${s}" ${(c.status||'draft')===s?'selected':''}>${s[0].toUpperCase()+s.slice(1)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label style="display:block;font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.12em;text-transform:uppercase;color:#6A6158;margin-bottom:6px">RPM ($ per million views)</label>
        <input id="cp-rpm" class="cx-input" type="number" min="0" step="0.01" value="${c.rpm||''}" placeholder="e.g. 250" style="width:100%"/>
      </div>
      <div>
        <label style="display:block;font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.12em;text-transform:uppercase;color:#6A6158;margin-bottom:6px">Budget ($)</label>
        <input id="cp-budget" class="cx-input" type="number" min="0" value="${c.budget||''}" placeholder="e.g. 50000" style="width:100%"/>
      </div>
      <div>
        <label style="display:block;font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.12em;text-transform:uppercase;color:#6A6158;margin-bottom:6px">Start Date</label>
        <input id="cp-start" class="cx-input" type="date" value="${c.start_date||''}" style="width:100%;color-scheme:dark"/>
      </div>
      <div>
        <label style="display:block;font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.12em;text-transform:uppercase;color:#6A6158;margin-bottom:6px">End Date</label>
        <input id="cp-end" class="cx-input" type="date" value="${c.end_date||''}" style="width:100%;color-scheme:dark"/>
      </div>
    </div>

    <!-- Platforms -->
    <div style="margin:16px 0">
      <label style="display:block;font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.12em;text-transform:uppercase;color:#6A6158;margin-bottom:8px">Platforms</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap" id="cp-plat-group">
        ${[['YouTube','#FF4444','rgba(255,0,0,.15)'],['Instagram','#E1306C','rgba(225,48,108,.15)'],['TikTok','rgba(255,255,255,.85)','rgba(255,255,255,.1)']].map(([p,tc,bg])=>{
          const sel=(()=>{const pl=c.platforms||c.platform||'';return Array.isArray(pl)?pl.includes(p):pl===p||pl==='All';})();
          return`<button type="button" class="cp-plat" data-plat="${p}" data-tc="${tc}" data-bg="${bg}" style="padding:7px 18px;border-radius:20px;border:1px solid ${sel?tc+'88':tc+'33'};background:${sel?bg:'transparent'};color:${sel?tc:'rgba(255,255,255,.38)'};font-size:.78rem;font-weight:600;cursor:pointer;transition:all .15s;font-family:'DM Sans',sans-serif">${p}</button>`;
        }).join('')}
        <div style="font-size:.72rem;color:#6A6158;display:flex;align-items:center;margin-left:4px">Select one or more</div>
      </div>
    </div>

    <!-- Requirements -->
    <div style="margin:16px 0 20px">
      <label style="display:block;font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.12em;text-transform:uppercase;color:#6A6158;margin-bottom:8px">Requirements</label>
      <textarea id="cp-req" class="cx-textarea" style="width:100%;min-height:90px" placeholder="One requirement per line&#10;e.g. Min 30 seconds&#10;Tag @clipency&#10;Use original audio">${(()=>{let r=c.requirements||"";try{const p=JSON.parse(r);if(Array.isArray(p))return p.join("\n");}catch(e){}return r;})()}</textarea>
      <div style="font-size:.72rem;color:#6A6158;margin-top:4px">One requirement per line. Shown as checklist to clippers.</div>
    </div>

    <!-- Description -->
    <div style="margin-bottom:24px">
      <label style="display:block;font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.12em;text-transform:uppercase;color:#6A6158;margin-bottom:8px">Description</label>
      <textarea id="cp-desc" class="cx-textarea" style="width:100%;min-height:72px" placeholder="Campaign brief for clippers…">${esc(c.description||'')}</textarea>
    </div>

    <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:16px;border-top:1px solid rgba(255,255,255,.07)">
      ${existing?`<button id="cp-delete" class="cx-btn danger">Delete</button>`:''}
      <div style="flex:1"></div>
      <button id="cp-close2" class="cx-btn ghost">Cancel</button>
      <button id="cp-save" class="cx-btn pri" style="background:#C4956A;color:#0A0908;min-width:130px">Save Campaign</button>
    </div>
  </div>`;

  (document.getElementById("cxos")||document.body).appendChild(panel);
  const close=()=>panel.remove();
  /* Client access list. Loaded after mount so the form paints immediately;
     a failure here must not block campaign editing. */
  (async()=>{
    try{
      const{data:clients}=await sb.from('profiles')
        .select('id,email,full_name,company_name').eq('role','client').order('created_at');
      const sel=panel.querySelector('#cp-client');
      if(!sel)return;
      (clients||[]).forEach(cl=>{
        const o=document.createElement('option');
        o.value=cl.id||cl.user_id;
        o.textContent=(cl.company_name||cl.full_name||cl.email)+' · '+cl.email;
        if(c.client_user_id===(cl.id||cl.user_id))o.selected=true;
        sel.appendChild(o);
      });
      if(!(clients||[]).length){
        sel.insertAdjacentHTML('beforeend','<option value="" disabled>No client accounts yet — create one under Clients</option>');
      }
    }catch(e){ /* leave the "not connected" default in place */ }
  })();

  panel.querySelector('#cp-close').onclick=close;
  panel.querySelector('#cp-close2').onclick=close;

  // Platform multi-select toggle
  panel.querySelectorAll('.cp-plat').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const isOn=btn.dataset.on==='1';
      btn.dataset.on=isOn?'0':'1';
      const tc=btn.dataset.tc;const bg=btn.dataset.bg;
      btn.style.background=isOn?'transparent':bg;
      btn.style.color=isOn?'rgba(255,255,255,.38)':tc;
      btn.style.borderColor=isOn?tc+'33':tc+'88';
    });
  });
  // Mark initially selected
  panel.querySelectorAll('.cp-plat').forEach(btn=>{
    if(btn.style.background&&btn.style.background!=='transparent'){btn.dataset.on='1';}
  });

  // Banner preview
  const fi=panel.querySelector('#cp-banner-file');
  fi.onchange=()=>{
    const f=fi.files[0];if(!f)return;
    const url=URL.createObjectURL(f);
    let img=panel.querySelector('#cp-banner-preview');
    if(!img){img=document.createElement('img');img.id='cp-banner-preview';img.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover';panel.querySelector('#cp-banner-drop').appendChild(img);}
    img.src=url;
    const bl=panel.querySelector('#cp-banner-label');if(bl)bl.style.display='none';
  };

  // Icon preview
  const iconFi=panel.querySelector('#cp-icon-file');
  if(iconFi){
    iconFi.onchange=()=>{
      const f=iconFi.files[0];if(!f)return;
      const url=URL.createObjectURL(f);
      let img=panel.querySelector('#cp-icon-preview');
      if(!img){img=document.createElement('img');img.id='cp-icon-preview';img.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover';panel.querySelector('#cp-icon-drop').appendChild(img);}
      img.src=url;
      const lbl=panel.querySelector('#cp-icon-label');if(lbl)lbl.style.display='none';
    };
  }
  // Icon clear
  const iconClearBtn=panel.querySelector('#cp-icon-clear');
  if(iconClearBtn){
    iconClearBtn.onclick=()=>{
      const img=panel.querySelector('#cp-icon-preview');if(img)img.remove();
      const lbl=panel.querySelector('#cp-icon-label');if(lbl)lbl.style.display='';
      if(iconFi)iconFi.value='';
      iconClearBtn.dataset.cleared='1';
    };
  }

  // Delete
  if(existing){
    panel.querySelector('#cp-delete').onclick=async()=>{
      if(!confirm('Delete this campaign? This cannot be undone.'))return;
      const{error}=await sb.from('campaigns').delete().eq('id',existing.id);
      if(error){alert(error.message);return;}
      close();await boot();
    };
  }

  // Save
  panel.querySelector('#cp-save').onclick=async()=>{
    const btn=panel.querySelector('#cp-save');
    const errEl=panel.querySelector('#cp-err');
    const title=panel.querySelector('#cp-title').value.trim();
    if(!title){panel.querySelector('#cp-title').focus();return;}
    btn.disabled=true;btn.textContent='Saving…';
    try{
      let asset_url=c.asset_url||null;
      const file=fi.files[0];
      if(file){
        const ext=file.name.split('.').pop();
        const path=`banners/${Date.now()}.${ext}`;
        const{error:ue}=await sb.storage.from('campaign-banners').upload(path,file,{upsert:true});
        if(ue)throw ue;
        const{data:{publicUrl}}=sb.storage.from('campaign-banners').getPublicUrl(path);
        asset_url=publicUrl;
      }
      // Icon upload
      let icon_url=c.icon_url||null;
      const iconClear2=panel.querySelector('#cp-icon-clear');
      if(iconClear2&&iconClear2.dataset.cleared==='1') icon_url=null;
      const iconFile=panel.querySelector('#cp-icon-file')?.files[0];
      if(iconFile){
        const ext2=(iconFile.name.split('.').pop()||'png').toLowerCase();
        const mimeMap={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',svg:'image/svg+xml'};
        const contentType=mimeMap[ext2]||iconFile.type||'image/png';
        const iconPath=`icons/${Date.now()}.${ext2}`;
        console.log('[icon upload] path:',iconPath,'type:',contentType);
        const{error:ie}=await sb.storage.from('campaign-banners').upload(iconPath,iconFile,{upsert:true,contentType});
        if(ie){console.error('[icon upload] error:',ie);throw new Error('Icon upload failed: '+(ie.message||JSON.stringify(ie)));}
        const{data:{publicUrl:iPub}}=sb.storage.from('campaign-banners').getPublicUrl(iconPath);
        icon_url=iPub;
        console.log('[icon upload] saved:',icon_url);
      }
      const selectedPlats=[...panel.querySelectorAll('.cp-plat[data-on="1"]')].map(b=>b.dataset.plat);
      const platform=selectedPlats.length===1?selectedPlats[0]:selectedPlats.length>1?selectedPlats.join(','):'All';
      const reqRaw=panel.querySelector('#cp-req').value;
      const requirements=reqRaw.split('\n').map(x=>x.trim()).filter(Boolean);
      const payload={
        title,brand_name:panel.querySelector('#cp-brand').value.trim()||null,
        genre:panel.querySelector('#cp-genre').value,
        status:panel.querySelector('#cp-status').value,
        platform,
        rpm:parseFloat(panel.querySelector('#cp-rpm').value)||null,
        budget:parseFloat(panel.querySelector('#cp-budget').value)||null,
        start_date:panel.querySelector('#cp-start').value||null,
        end_date:panel.querySelector('#cp-end').value||null,
        requirements,
        description:panel.querySelector('#cp-desc').value.trim()||null,
        asset_url,icon_url,updated_at:new Date().toISOString()
      };
      let err, campId=existing?existing.id:null;
      if(existing){({error:err}=await sb.from('campaigns').update(payload).eq('id',existing.id));}
      else{
        payload.created_by=me.id;payload.created_at=new Date().toISOString();
        const ins=await sb.from('campaigns').insert(payload).select('id').maybeSingle();
        err=ins.error; campId=ins.data&&ins.data.id;
      }
      if(err)throw err;

      /* Client link goes through admin_set_campaign_client rather than the
         payload: it is staff-guarded in the database, so the check cannot be
         bypassed by editing this page. */
      const clientSel=panel.querySelector('#cp-client');
      if(clientSel && campId){
        const chosen=clientSel.value||null;
        const before=existing?(existing.client_user_id||null):null;
        if(chosen!==before){
          const{error:linkErr}=await sb.rpc('admin_set_campaign_client',
            {p_campaign_id:campId, p_user_id:chosen});
          if(linkErr)throw new Error('Campaign saved, but client access failed: '+linkErr.message);
        }
      }
      close();await boot();
    }catch(e){
      errEl.innerHTML=`<div class="cx-alert err" style="margin-bottom:14px">${esc(e.message||'Save failed')}</div>`;
      btn.disabled=false;btn.textContent='Save Campaign';
    }
  };
}

window.__subFilter = function(){
  const p=new URLSearchParams(location.search);
  const q=(document.getElementById('cx-sub-search')?.value||'').trim();
  const camp=document.getElementById('cx-sub-camp')?.value||'';
  const plat=document.getElementById('cx-sub-plat')?.value||'';
  const from=document.getElementById('cx-sub-from')?.value||'';
  const to=document.getElementById('cx-sub-to')?.value||'';
  if(q)p.set('q',q);else p.delete('q');
  if(camp)p.set('camp',camp);else p.delete('camp');
  if(plat)p.set('plat',plat);else p.delete('plat');
  if(from)p.set('from',from);else p.delete('from');
  if(to)p.set('to',to);else p.delete('to');
  location.search='?'+p.toString();
};
window.__subClear = function(){
  const p=new URLSearchParams(location.search);
  const tab=p.get('tab')||'pending';
  location.search='?tab='+tab;
};
async function renderReviews(){
  const params=new URLSearchParams(location.search);
  const tab=params.get('tab')||'pending';
  const q=(params.get('q')||'').trim().toLowerCase();
  const campFilter=params.get('camp')||'';
  const platFilter=params.get('plat')||'';
  const from=params.get('from')||'';
  const to=params.get('to')||'';
  let srData=[],profMap={};
  try{
    const srQ=await sb.from('clip_submissions').select('id,user_id,campaign_id,campaign_title,platform,handle,clip_url,views_count,views,status,rejection_reason,appeal_note,approved_amount,earning_amount,created_at,reviewed_at,edited_at,edited_by_email,likes,comments').order('created_at',{ascending:false});
    srData=srQ.data||[];
    const uids=[...new Set(srData.map(x=>x.user_id).filter(Boolean))];
    if(uids.length){const{data:profs}=await sb.from('profiles').select('id,email,full_name').in('id',uids);profMap=Object.fromEntries((profs||[]).map(p=>[p.id,p]));}
  }catch(e){console.warn(e);}
  const srAll=srData.map(x=>({...x,user_email:profMap[x.user_id]?.email||'—',user_name:profMap[x.user_id]?.full_name||''}));
  let rows=tab==='all'?srAll:srAll.filter(x=>x.status===tab);
  if(campFilter)rows=rows.filter(x=>x.campaign_title===campFilter);
  if(platFilter)rows=rows.filter(x=>(x.platform||'').toLowerCase()===platFilter.toLowerCase());
  if(q)rows=rows.filter(x=>
    (x.user_email||'').toLowerCase().includes(q) ||
    (x.user_name||'').toLowerCase().includes(q) ||
    (x.handle||'').toLowerCase().includes(q)
  );
  if(from){const fromTs=new Date(from+'T00:00:00').getTime();rows=rows.filter(x=>new Date(x.created_at).getTime()>=fromTs);}
  if(to){const toTs=new Date(to+'T23:59:59').getTime();rows=rows.filter(x=>new Date(x.created_at).getTime()<=toTs);}
  const counts={pending:srAll.filter(x=>x.status==='pending').length,approved:srAll.filter(x=>x.status==='approved').length,rejected:srAll.filter(x=>x.status==='rejected').length,all:srAll.length};
  const qs=(overrides)=>{
    const p=new URLSearchParams(location.search);
    Object.entries(overrides).forEach(([k,v])=>{ if(v===''||v==null)p.delete(k);else p.set(k,v); });
    return '?'+p.toString();
  };
  const tabs=['pending','approved','rejected','all'].map(t=>`<button class="cx-tab${tab===t?' on':''}" onclick="location.search='${qs({tab:t})}'">${t[0].toUpperCase()+t.slice(1)} <span style="opacity:.5;font-size:.75em">${counts[t]||0}</span></button>`).join('');
  const fmtViews=n=>{n=Number(n||0);return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1000?(n/1000).toFixed(0)+'K':String(n||0);};
  const campOptions=[...new Set(srAll.map(x=>x.campaign_title).filter(Boolean))].sort();
  const platOptions=[...new Set(srAll.map(x=>x.platform).filter(Boolean))].sort();
  const filterBar=`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:14px 0">
    <input type="text" id="cx-sub-search" placeholder="Search clipper email, name or handle…" value="${esc(q)}"
      style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:7px 12px;color:#f5f5f7;font-size:13px;min-width:220px"
      onkeydown="if(event.key==='Enter')window.__subFilter()"/>
    <select id="cx-sub-camp" onchange="window.__subFilter()"
      style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:7px 12px;color:#f5f5f7;font-size:13px">
      <option value="">All campaigns</option>
      ${campOptions.map(c=>`<option value="${esc(c)}" ${campFilter===c?'selected':''}>${esc(c)}</option>`).join('')}
    </select>
    <select id="cx-sub-plat" onchange="window.__subFilter()"
      style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:7px 12px;color:#f5f5f7;font-size:13px">
      <option value="">All platforms</option>
      ${platOptions.map(pl=>`<option value="${esc(pl)}" ${platFilter.toLowerCase()===String(pl).toLowerCase()?'selected':''}>${esc(pl)}</option>`).join('')}
    </select>
    <input type="date" id="cx-sub-from" value="${esc(from)}" title="From date"
      style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:6px 10px;color:#f5f5f7;font-size:13px"
      onchange="window.__subFilter()"/>
    <span style="color:rgba(255,255,255,.3);font-size:12px">to</span>
    <input type="date" id="cx-sub-to" value="${esc(to)}" title="To date"
      style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:6px 10px;color:#f5f5f7;font-size:13px"
      onchange="window.__subFilter()"/>
    <button class="cx-btn ghost sm" onclick="window.__subFilter()">Apply</button>
    <button class="cx-btn ghost sm" onclick="window.__subClear()">Clear filters</button>
  </div>`;
  const rowsHtml=rows.length?`<div class="cx-tw"><table class="cx-t" style="table-layout:auto">
    <thead><tr><th>Clipper</th><th>Campaign</th><th>Platform</th><th>Clip</th><th>Views</th><th>Earnings</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${rows.map(r=>{
      const views=Number(r.views_count||r.views||0);
      const amt=Number(r.approved_amount||r.earning_amount||0);
      return`<tr>
      <td><div style="font-weight:600;font-size:12.5px;white-space:nowrap">${esc(r.user_name||r.user_email||'—')}</div><div style="font-size:10.5px;color:rgba(255,255,255,.35)">${esc(r.user_email||'')}</div></td>
      <td style="font-size:12px;max-width:130px"><div style="font-weight:600">${esc(r.campaign_title||'—')}</div></td>
      <td><div style="font-size:11.5px">${esc(r.platform||'—')}</div><div style="font-size:10.5px;color:rgba(196,149,106,.7);font-family:'Space Mono',monospace">@${esc(r.handle||'—')}</div></td>
      <td>${r.clip_url?`<a href="${esc(r.clip_url)}" target="_blank" style="color:#C4956A;font-size:12px;text-decoration:none;white-space:nowrap">🔗 Open ↗</a>`:'—'}</td>
      <td style="font-size:13px;font-weight:600;color:${views>0?'#F5F0EB':'rgba(255,255,255,.3)'}">${fmtViews(views)}</td>
      <td style="font-size:13px;font-weight:700;color:${amt>0?'#6EE7B7':'rgba(255,255,255,.3)'}">${amt>0?'$'+amt.toLocaleString('en-US'):'—'}</td>
      <td><span class="cx-badge ${r.status}">${r.status||'—'}</span>${r.rejection_reason?`<div style="font-size:10px;color:#F87171;margin-top:2px">${esc(r.rejection_reason.slice(0,30))}…</div>`:''}${r.appeal_note?`<div style="font-size:10px;color:#FACC15;margin-top:2px">↩ Appeal: ${esc(r.appeal_note.slice(0,40))}${r.appeal_note.length>40?'…':''}</div>`:''}${r.edited_at?`<div class="cx-edited">✏ ${esc((r.edited_by_email||'admin').split('@')[0])} · ${new Date(r.edited_at).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</div>`:''}</td>
      <td><div class="cx-btns" style="flex-direction:column;gap:5px">
        <button class="cx-btn ok sm cx-review-btn" style="width:100%;justify-content:center" data-id="${r.id}" data-name="${esc(r.user_name||r.user_email||'')}" data-camp="${esc(r.campaign_title||'')}" data-platform="${esc(r.platform||'')}" data-handle="${esc(r.handle||'')}" data-clip="${esc(r.clip_url||'')}" data-views="${views}" data-amt="${amt}" data-status="${r.status}" data-likes="${Number(r.likes||0)}" data-comments="${Number(r.comments||0)}" data-appeal="${esc(r.appeal_note||'')}" data-rejreason="${esc(r.rejection_reason||'')}" data-editedat="${esc(r.edited_at||'')}" data-editedby="${esc(r.edited_by_email||'')}">${r.status==='approved'?'✏ Edit':r.status==='rejected'?'↺ Re-review':'✓ Review'}</button>
        ${r.status==='pending'?`<button class="cx-btn danger sm" style="width:100%;justify-content:center" onclick="quickReject('${esc(r.id)}')">✗ Reject</button>`:''}
      </div></td>
    </tr>`;}).join('')}</tbody>
  </table></div>`:`<div class="cx-empty">No submissions match these filters.</div>`;
  const subParts=[`${rows.length} submission${rows.length!==1?'s':''}`];
  if(tab!=='all')subParts.push(`in ${tab}`);
  if(campFilter)subParts.push(`for "${esc(campFilter)}"`);
  if(platFilter)subParts.push(`on ${esc(platFilter)}`);
  if(q)subParts.push(`matching "${esc(q)}"`);
  if(from||to)subParts.push(`between ${from||'…'} and ${to||'…'}`);
  return page({kicker:'Review Control',title:'Clip submissions.',sub:'Review the clip, then approve or reject. Views, likes and earnings are fetched and kept up to date automatically.',
    body:`<div class="cx-sec">
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">
      ${['pending','approved','rejected','all'].map(t=>`<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:14px 16px;text-align:center"><div style="font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.35);margin-bottom:6px">${t}</div><div style="font-size:1.6rem;font-weight:800;color:${t==='pending'?'#FACC15':t==='approved'?'#6EE7B7':t==='rejected'?'#F87171':'#F5F0EB'}">${counts[t]||0}</div></div>`).join('')}
    </div>
    <div class="cx-sh"><div><div class="cx-st">Submissions</div><div class="cx-sd">${subParts.join(' · ')}</div></div></div>
    <div class="cx-tabs">${tabs}</div>${filterBar}${rowsHtml}</div>`});
}

window.openReviewModal=function(id,name,camp,platform,handle,clipUrl,views,amt,status,likes,comments,appealNote,priorRejectReason,editedAt,editedByEmail){
  /* Numbers are no longer typed. Approving fetches the live view/like/comment
     counts from the platform, and earnings are derived in the database from the
     campaign rate (rpm per 1M views) on every refresh — so a payout tracks the
     clip as it keeps growing instead of freezing at whatever was typed here. */
  likes=likes||0; comments=comments||0; views=views||0;
  const MIN_VIEWS=500;
  const engRate=views>0?((likes+comments)/views*100).toFixed(2):'0.00';
  const fmt=n=>Number(n||0).toLocaleString('en-US');
  const panel=document.createElement('div');
  panel.className='cx-panel';
  panel.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);backdrop-filter:blur(6px);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px;';
  panel.innerHTML=`<div style="background:#181410;border:1px solid rgba(196,149,106,.2);border-radius:18px;width:100%;max-width:560px;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.7);max-height:90vh;overflow-y:auto;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;">
      <div>
        <div style="font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.16em;text-transform:uppercase;color:#C4956A;margin-bottom:5px;">${status==='approved'?'Approved Submission':'Review Submission'}</div>
        <h3 style="font-family:'Instrument Serif',serif;font-size:1.4rem;color:#F5F0EB;font-weight:400;">${esc(name)}</h3>
        <div style="font-size:.78rem;color:#6A6158;margin-top:2px;">${esc(camp)} · ${esc(platform)} · @${esc(handle)}</div>
      </div>
      <button onclick="this.closest('.cx-panel').remove()" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#B8AFA8;width:32px;height:32px;border-radius:7px;cursor:pointer;font-size:14px;flex-shrink:0;">✕</button>
    </div>
    ${clipUrl?`<a href="${esc(clipUrl)}" target="_blank" style="display:flex;align-items:center;gap:8px;background:rgba(196,149,106,.07);border:1px solid rgba(196,149,106,.15);border-radius:9px;padding:12px 14px;text-decoration:none;color:#C4956A;font-size:.85rem;margin-bottom:16px;font-weight:600;">🔗 Open clip proof ↗</a>`:'<div style="color:#F87171;font-size:.8rem;margin-bottom:14px;">⚠ No clip URL on this submission.</div>'}
    ${priorRejectReason?`<div style="background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.2);border-radius:9px;padding:10px 14px;margin-bottom:10px;font-size:.78rem;color:#F87171;"><b>Prior rejection reason:</b> ${esc(priorRejectReason)}</div>`:''}
    ${appealNote?`<div style="background:rgba(250,204,21,.08);border:1px solid rgba(250,204,21,.2);border-radius:9px;padding:10px 14px;margin-bottom:12px;font-size:.78rem;color:#FACC15;"><b>↩ Clipper appeal:</b> ${esc(appealNote)}</div>`:''}
    <div id="rm-err" style="margin-bottom:10px;"></div>

    <div id="rm-metrics" style="background:rgba(196,149,106,.06);border:1px solid rgba(196,149,106,.15);border-radius:10px;padding:14px 16px;margin-bottom:16px;">
      <div style="font-family:'Space Mono',monospace;font-size:.52rem;letter-spacing:.14em;text-transform:uppercase;color:#6A6158;margin-bottom:10px;">Measured metrics</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;text-align:center;">
        <div><div id="rm-v" style="font-size:1.15rem;color:#F5F0EB;font-weight:700;">${views?fmt(views):'—'}</div><div style="font-size:.62rem;color:#6A6158;text-transform:uppercase;letter-spacing:.08em;">Views</div></div>
        <div><div id="rm-l" style="font-size:1.15rem;color:#F5F0EB;font-weight:700;">${views?fmt(likes):'—'}</div><div style="font-size:.62rem;color:#6A6158;text-transform:uppercase;letter-spacing:.08em;">Likes</div></div>
        <div><div id="rm-c" style="font-size:1.15rem;color:#F5F0EB;font-weight:700;">${views?fmt(comments):'—'}</div><div style="font-size:.62rem;color:#6A6158;text-transform:uppercase;letter-spacing:.08em;">Comments</div></div>
        <div><div id="rm-e" style="font-size:1.15rem;color:#C4956A;font-weight:700;">${views?engRate+'%':'—'}</div><div style="font-size:.62rem;color:#6A6158;text-transform:uppercase;letter-spacing:.08em;">Engagement</div></div>
      </div>
      <div id="rm-note" style="font-size:.72rem;color:#6A6158;margin-top:11px;line-height:1.5;">
        ${status==='approved'?'Refreshed automatically every 12 hours for the first 3 days, then daily to day 14. Earnings follow the campaign rate.':'Approving fetches these from the platform and calculates earnings from the campaign rate. Nothing to type.'}
      </div>
    </div>

    <div style="display:flex;gap:9px;padding-top:14px;border-top:1px solid rgba(255,255,255,.06);">
      ${status!=='approved'?`<button id="rm-approve" class="cx-btn ok" style="flex:1;justify-content:center;">✓ Approve</button>`:`<button id="rm-refresh" class="cx-btn" style="flex:1;justify-content:center;">↻ Refresh metrics</button>`}
      ${status!=='rejected'?`<button id="rm-reject" class="cx-btn danger" style="flex:1;justify-content:center;">✗ Reject${status==='approved'?' (Unapprove)':''}</button>`:''}
      <button onclick="this.closest('.cx-panel').remove()" class="cx-btn ghost">Cancel</button>
    </div>
  </div>`;
  (document.getElementById('cxos')||document.body).appendChild(panel);

  const errEl=panel.querySelector('#rm-err');
  const showErr=t=>{errEl.innerHTML=`<div style="color:#F87171;font-size:.8rem;">${esc(t)}</div>`;};
  const showWarn=t=>{errEl.innerHTML=`<div style="color:#FACC15;font-size:.8rem;">${esc(t)}</div>`;};

  /* Reads the live counts, then paints them in. Returns the refreshed row. */
  async function pullMetrics(){
    const r=await sb.functions.invoke('fetch-clip-metrics',{body:{submission_id:id}});
    if(r.error){
      let detail='';
      try{ detail=(await r.error.context.json()).message||''; }catch(_){}
      throw new Error(detail||r.error.message||'Could not read the clip metrics.');
    }
    const{data,error}=await sb.from('clip_submissions')
      .select('views_count,likes,comments,engagement_rate,approved_amount,metrics_status,metrics_error')
      .eq('id',id).maybeSingle();
    if(error)throw error;
    if(data){
      panel.querySelector('#rm-v').textContent=fmt(data.views_count);
      panel.querySelector('#rm-l').textContent=fmt(data.likes);
      panel.querySelector('#rm-c').textContent=fmt(data.comments);
      panel.querySelector('#rm-e').textContent=Number(data.engagement_rate||0).toFixed(2)+'%';
    }
    return data||{};
  }

  const aBtn=panel.querySelector('#rm-approve');
  if(aBtn)aBtn.onclick=async()=>{
    aBtn.disabled=true;aBtn.textContent='Approving…';errEl.innerHTML='';
    try{
      /* Approve first: the metrics fetcher only accepts clips that are already
         approved on a live campaign, so the order here is not optional. */
      const{error}=await sb.rpc('admin_approve_submission',{p_id:id,p_amount:0,p_views:0});
      if(error)throw error;
      aBtn.textContent='Reading metrics…';
      const row=await pullMetrics();
      const v=Number(row.views_count||0);
      if(row.metrics_status!=='ok'){
        showWarn('Approved, but the metrics could not be read yet'+(row.metrics_error?': '+row.metrics_error:'.')+' It will retry automatically.');
      }else if(v<MIN_VIEWS){
        showWarn('Approved — but only '+fmt(v)+' views, under the '+fmt(MIN_VIEWS)+' minimum. Reject if that is not acceptable.');
      }else{
        toast('✓ Approved · '+fmt(v)+' views · $'+Number(row.approved_amount||0).toFixed(2),'ok');
        panel.remove();await boot();return;
      }
      aBtn.textContent='✓ Approved';await boot();
    }catch(e){showErr(e.message);aBtn.disabled=false;aBtn.textContent='✓ Approve';}
  };

  const refBtn=panel.querySelector('#rm-refresh');
  if(refBtn)refBtn.onclick=async()=>{
    refBtn.disabled=true;refBtn.textContent='Reading…';errEl.innerHTML='';
    try{ const row=await pullMetrics();
      toast('Updated · '+fmt(row.views_count)+' views · $'+Number(row.approved_amount||0).toFixed(2),'ok');
      await boot();
    }catch(e){showErr(e.message);}
    refBtn.disabled=false;refBtn.textContent='↻ Refresh metrics';
  };

  const rBtn=panel.querySelector('#rm-reject');
  if(rBtn)rBtn.onclick=async()=>{
    /* Rejecting touches nothing else — no fetch, no earnings, no metrics. */
    const reason=prompt('Rejection reason (shown to clipper):','');
    if(reason===null)return;
    if(!reason.trim()){alert('Enter a rejection reason');return;}
    rBtn.disabled=true;rBtn.textContent='Rejecting…';
    try{
      const{error}=await sb.rpc('admin_reject_submission',{p_id:id,p_reason:reason});
      if(error)throw error;
      panel.remove();await boot();
    }catch(e){alert(e.message);rBtn.disabled=false;rBtn.textContent='✗ Reject';}
  };
};
window.quickReject=async function(id){
  const reason=prompt('Rejection reason (shown to clipper):','');
  if(reason===null)return;
  if(!reason.trim()){alert('Enter a rejection reason');return;}
  try{
    const{error}=await sb.rpc('admin_reject_submission',{p_id:id,p_reason:reason});
    if(error)throw error;
    await boot();
  }catch(e){alert(e.message);}
};


/* ══ PAYOUTS ════════════════════════════════════════════════════════ */
window.__payFilter = function(){
  const p=new URLSearchParams(location.search);
  const q=(document.getElementById('cx-pay-search')?.value||'').trim();
  const ref=(document.getElementById('cx-pay-ref')?.value||'').trim();
  const minA=document.getElementById('cx-pay-min')?.value||'';
  const maxA=document.getElementById('cx-pay-max')?.value||'';
  const from=document.getElementById('cx-pay-from')?.value||'';
  const to=document.getElementById('cx-pay-to')?.value||'';
  if(q)p.set('q',q);else p.delete('q');
  if(ref)p.set('ref',ref);else p.delete('ref');
  if(minA)p.set('min',minA);else p.delete('min');
  if(maxA)p.set('max',maxA);else p.delete('max');
  if(from)p.set('from',from);else p.delete('from');
  if(to)p.set('to',to);else p.delete('to');
  location.search='?'+p.toString();
};
window.__payClear = function(){
  const p=new URLSearchParams(location.search);
  const tab=p.get('tab')||'pending';
  location.search='?tab='+tab;
};
async function renderPayouts(){
  const params=new URLSearchParams(location.search);
  const tab=params.get('tab')||'pending';
  const q=(params.get('q')||'').trim().toLowerCase();
  const refFilter=(params.get('ref')||'').trim().toLowerCase();
  const minA=params.get('min')||'';
  const maxA=params.get('max')||'';
  const from=params.get('from')||'';
  const to=params.get('to')||'';
  const prQ=await sb.from('payout_requests').select('id,user_id,amount,status,note,requested_at,processed_at,transaction_reference').order('requested_at',{ascending:false});
  const prData=prQ.data||[];
  const puids=[...new Set(prData.map(x=>x.user_id).filter(Boolean))];
  const pprofQ=puids.length?await sb.from('profiles').select('id,email,full_name').in('id',puids):{data:[]};
  const pprofMap=Object.fromEntries((pprofQ.data||[]).map(p=>[p.id,p]));
  const pmQ=puids.length?await sb.from('user_payment_methods').select('user_id,method_type,upi_id,paypal_email,bank_name,bank_account,ifsc,account_name,is_primary').in('user_id',puids).eq('is_primary',true):{data:[]};
  const pmMap=Object.fromEntries((pmQ.data||[]).map(m=>[m.user_id,m]));
  const fmtPayTarget=(m)=>{
    if(!m)return'<span style="color:rgba(255,255,255,.3)">No method on file</span>';
    if(m.method_type==='upi')return`<span style="color:#a5b4fc">UPI</span> ${esc(m.upi_id||'—')}`;
    if(m.method_type==='paypal')return`<span style="color:#a5b4fc">PayPal</span> ${esc(m.paypal_email||'—')}`;
    if(m.method_type==='bank')return`<span style="color:#a5b4fc">Bank</span> ${esc(m.bank_account||'—')} <span style="color:rgba(255,255,255,.35)">(${esc(m.ifsc||'—')})</span>`;
    return`<span style="color:rgba(255,255,255,.3)">${esc(m.method_type||'—')}</span>`;
  };
  const allPR=prData.map(x=>({...x,user_email:pprofMap[x.user_id]?.email||'—',user_name:pprofMap[x.user_id]?.full_name||'',available_balance:0,pay_target:fmtPayTarget(pmMap[x.user_id])}));
  let rows=tab==='all'?allPR:allPR.filter(x=>x.status===tab);
  if(q)rows=rows.filter(x=>
    (x.user_email||'').toLowerCase().includes(q) ||
    (x.user_name||'').toLowerCase().includes(q)
  );
  if(refFilter)rows=rows.filter(x=>(x.transaction_reference||'').toLowerCase().includes(refFilter));
  if(minA)rows=rows.filter(x=>Number(x.amount||0)>=Number(minA));
  if(maxA)rows=rows.filter(x=>Number(x.amount||0)<=Number(maxA));
  if(from){const fromTs=new Date(from+'T00:00:00').getTime();rows=rows.filter(x=>new Date(x.requested_at).getTime()>=fromTs);}
  if(to){const toTs=new Date(to+'T23:59:59').getTime();rows=rows.filter(x=>new Date(x.requested_at).getTime()<=toTs);}
  const totalPending=(rows||[]).filter(r=>r.status==='pending').reduce((a,r)=>a+(r.amount||0),0);
  const filteredSum=(rows||[]).reduce((a,r)=>a+(r.amount||0),0);
  const qs=(overrides)=>{
    const p=new URLSearchParams(location.search);
    Object.entries(overrides).forEach(([k,v])=>{ if(v===''||v==null)p.delete(k);else p.set(k,v); });
    return '?'+p.toString();
  };
  const tabs=['pending','paid','all'].map(t=>`<button class="cx-tab${tab===t?' on':''}" onclick="location.search='${qs({tab:t})}'">${t.charAt(0).toUpperCase()+t.slice(1)}</button>`).join('');
  const filterBar=`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:14px 0">
    <input type="text" id="cx-pay-search" placeholder="Search clipper email or name…" value="${esc(q)}"
      style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:7px 12px;color:#f5f5f7;font-size:13px;min-width:210px"
      onkeydown="if(event.key==='Enter')window.__payFilter()"/>
    <input type="text" id="cx-pay-ref" placeholder="Search reference (UTR, UPI id)…" value="${esc(refFilter)}"
      style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:7px 12px;color:#f5f5f7;font-size:13px;min-width:200px"
      onkeydown="if(event.key==='Enter')window.__payFilter()"/>
    <input type="number" id="cx-pay-min" placeholder="Min $" value="${esc(minA)}"
      style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:7px 10px;color:#f5f5f7;font-size:13px;width:90px"
      onchange="window.__payFilter()"/>
    <span style="color:rgba(255,255,255,.3);font-size:12px">to</span>
    <input type="number" id="cx-pay-max" placeholder="Max $" value="${esc(maxA)}"
      style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:7px 10px;color:#f5f5f7;font-size:13px;width:90px"
      onchange="window.__payFilter()"/>
    <input type="date" id="cx-pay-from" value="${esc(from)}" title="From date"
      style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:6px 10px;color:#f5f5f7;font-size:13px"
      onchange="window.__payFilter()"/>
    <span style="color:rgba(255,255,255,.3);font-size:12px">to</span>
    <input type="date" id="cx-pay-to" value="${esc(to)}" title="To date"
      style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:6px 10px;color:#f5f5f7;font-size:13px"
      onchange="window.__payFilter()"/>
    <button class="cx-btn ghost sm" onclick="window.__payFilter()">Apply</button>
    <button class="cx-btn ghost sm" onclick="window.__payClear()">Clear filters</button>
  </div>`;
  const rowsHtml=(rows||[]).length?`<div class="cx-tw"><table class="cx-t">
    <thead><tr><th>Clipper</th><th>Pay To</th><th>Requested</th><th>Available Balance</th><th>Status</th><th>Reference</th><th>Date</th><th>Actions</th></tr></thead>
    <tbody>${(rows||[]).map(r=>`<tr>
      <td><div style="font-size:12.5px;font-weight:600">${esc(r.user_email||'—')}</div><div style="font-size:11px;color:rgba(255,255,255,.35)">${esc(r.user_name||'')}</div></td>
      <td style="font-size:12px;white-space:nowrap">${r.pay_target}</td>
      <td style="font-size:15px;font-weight:700;color:#f5f5f7">${fmtMoney(r.amount)}</td>
      <td style="font-size:13px;color:#4ade80">${fmtMoney(r.available_balance)}</td>
      <td><span class="cx-badge ${r.status}">${esc(r.status||'—')}</span></td>
      <td style="font-size:11.5px;color:rgba(255,255,255,.4)">${esc(r.transaction_reference||'—')}</td>
      <td style="font-size:11.5px;color:rgba(255,255,255,.4)">${fmtDate(r.requested_at)}</td>
      <td><div class="cx-btns">
        ${r.status==='pending'?`<button class="cx-btn ok sm" data-pay="${esc(r.id)}">Mark Paid</button>`:'<span style="font-size:11px;color:rgba(255,255,255,.3)">Done</span>'}
      </div></td>
    </tr>`).join('')}</tbody>
  </table></div>`:`<div class="cx-empty">No payouts match these filters.</div>`;
  const subParts=[`${rows.length} payout${rows.length!==1?'s':''}`];
  if(tab!=='all')subParts.push(`in ${tab}`);
  if(q)subParts.push(`matching "${esc(q)}"`);
  if(refFilter)subParts.push(`ref contains "${esc(refFilter)}"`);
  if(minA||maxA)subParts.push(`$${minA||'0'}–$${maxA||'∞'}`);
  if(from||to)subParts.push(`between ${from||'…'} and ${to||'…'}`);
  return page({kicker:'Payout Control',title:'Withdrawals.',sub:'Process clipper withdrawal requests. Mark as paid once transferred.',
    body:`<div class="cx-sec">
    ${tab==='pending'&&totalPending>0?`<div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:12px;padding:16px 20px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between"><span style="color:#fbbf24;font-weight:600">Total pending payout</span><span style="font-size:22px;font-weight:800;color:#f5f5f7">${fmtMoney(totalPending)}</span></div>`:''}
    <div style="background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.2);border-radius:12px;padding:14px 20px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between">
      <span style="color:#a5b4fc;font-weight:600">Sum of filtered results (${rows.length})</span>
      <span style="font-size:20px;font-weight:800;color:#f5f5f7">${fmtMoney(filteredSum)}</span>
    </div>
    <div class="cx-sh"><div><div class="cx-st">Payout requests</div><div class="cx-sd">${subParts.join(' · ')}</div></div>
    <a class="cx-btn ghost" href="https://finance.clipency.in" target="_blank" rel="noopener">Open Finance OS</a></div>
    <div class="cx-tabs">${tabs}</div>${filterBar}${rowsHtml}</div>`});
}

/* ══ USERS ═══════════════════════════════════════════════════════════ */
async function renderUsers(){
  const[{data:admins},{data:reviewers}]=await Promise.all([
    sb.from('admin_users').select('id,email,user_id,created_at').order('created_at',{ascending:false}),
    sb.from('reviewer_users').select('id,email,user_id,created_at').order('created_at',{ascending:false}),
  ]);
  const map=new Map();
  (admins||[]).forEach(r=>map.set(r.email.toLowerCase(),{email:r.email,role:'admin',created_at:r.created_at}));
  (reviewers||[]).forEach(r=>{const e=r.email.toLowerCase();if(!map.has(e))map.set(e,{email:r.email,role:'reviewer',created_at:r.created_at});});
  const users=[...map.values()].sort((a,b)=>a.role==='admin'&&b.role!=='admin'?-1:b.role==='admin'&&a.role!=='admin'?1:a.email.localeCompare(b.email));
  const myEmail=me?.email?.toLowerCase();
  const tableHtml=`<div class="cx-tw"><table class="cx-t">
    <thead><tr><th>Email</th><th>Role</th><th>Added</th><th>Actions</th></tr></thead>
    <tbody>${users.length?users.map(u=>{
      const isSelf=u.email.toLowerCase()===myEmail;
      return`<tr><td><strong>${esc(u.email)}</strong>${isSelf?'<div style="font-size:10.5px;color:rgba(255,255,255,.35)">You</div>':''}</td>
        <td><span class="cx-badge ${u.role}">${u.role==='admin'?'Admin':'Reviewer'}</span></td>
        <td style="font-size:11.5px;color:rgba(255,255,255,.4)">${fmtDate(u.created_at)}</td>
        <td><div class="cx-btns">
          <button class="cx-btn ghost sm" data-ra="admin" data-email="${esc(u.email)}" ${u.role==='admin'?'disabled':''}>Admin</button>
          <button class="cx-btn ghost sm" data-ra="reviewer" data-email="${esc(u.email)}" ${u.role==='reviewer'?'disabled':''}>Reviewer</button>
          <button class="cx-btn danger sm" data-ra="revoke" data-email="${esc(u.email)}" ${isSelf?'disabled':''}>Revoke</button>
        </div></td></tr>`;
    }).join(''):`<tr><td colspan="4"><div class="cx-empty">No users yet.</div></td></tr>`}</tbody>
  </table></div>`;
  return page({kicker:'Access Control',title:'Users & roles.',sub:'Manage who can access the Admin OS.',
    body:`<div class="cx-sec"><div class="cx-sh"><div><div class="cx-st">Add / update access</div><div class="cx-sd">Changes take effect on next sign in.</div></div></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:20px">
      <input class="cx-input" id="cx-role-email" type="email" placeholder="name@example.com" style="min-width:230px;margin:0"/>
      <select class="cx-select" id="cx-role-select" style="margin:0"><option value="reviewer">Reviewer</option><option value="admin">Admin</option></select>
      <button class="cx-btn pri" id="cx-role-save">Save access</button>
    </div></div>
    <div class="cx-sec"><div class="cx-sh"><div><div class="cx-st">Current team</div><div class="cx-sd">${users.length} people</div></div></div>${tableHtml}</div>`});
}

/* ══ ROUTER ════════════════════════════════════════════════════════ */
function humanizeAudit(r){
  const o=r.old_data||{},n=r.new_data||{},t=r.target_table||'';
  const action=r.action||'';
  const money=v=>'$'+Number(v||0).toLocaleString('en-US');
  const fmtV=v=>{const vn=Number(v||0);return vn>=1e6?(vn/1e6).toFixed(1)+'M':vn>=1000?(vn/1000).toFixed(0)+'K':String(vn);};
  const actorName=(r.actor_email||'Unknown').split('@')[0];
  const roleTag=r.actor_role?` <span style="font-size:9px;background:rgba(255,255,255,.08);padding:1px 5px;border-radius:4px;color:rgba(255,255,255,.4)">${r.actor_role}</span>`:'';
  if(t==='clip_submissions'){
    const handle=n.handle||o.handle||'—';const platform=n.platform||o.platform||'—';
    const campaign=n.campaign_title||o.campaign_title||'Campaign';
    const views=n.views_count||n.views||o.views_count||0;const earning=n.approved_amount||n.earning_amount||o.approved_amount||0;
    const reason=n.rejection_reason||'';
    if(n.status==='approved')return{icon:'✅',who:actorName+roleTag,text:`Approved @${handle}'s ${platform} clip`,detail:`${campaign}${views?' · '+fmtV(views)+' views':''}${earning?' · '+money(earning)+' earned':''}`,status:'approved'};
    if(n.status==='rejected')return{icon:'❌',who:actorName+roleTag,text:`Rejected @${handle}'s ${platform} clip`,detail:`${campaign}${reason?' · "'+reason.slice(0,80)+'"':' · No reason given'}`,status:'rejected'};
    if(o.status==='approved'&&n.status==='approved')return{icon:'✏️',who:actorName+roleTag,text:`Edited @${handle}'s approved ${platform} clip`,detail:`${campaign}${views?' · Updated to '+fmtV(views)+' views':''}${earning?' · '+money(earning):''}`,status:'edited'};
    if(action.startsWith('delete'))return{icon:'🗑️',who:actorName+roleTag,text:`Deleted @${handle}'s clip`,detail:campaign,status:'done'};
    return{icon:'📎',who:actorName+roleTag,text:`Updated @${handle}'s ${platform} clip`,detail:`${campaign} · ${o.status||'?'} → ${n.status||'?'}`,status:n.status||'done'};
  }
  if(t==='payout_requests'){
    const amt=money(n.amount||o.amount);const ref=n.transaction_reference?' · Ref: '+n.transaction_reference:'';const payUser=n.user_email||o.user_email||'—';
    if(n.status==='paid')return{icon:'💸',who:actorName+roleTag,text:`Marked ${amt} payout PAID`,detail:'Clipper: '+payUser+ref,status:'paid'};
    if(n.status==='rejected')return{icon:'❌',who:actorName+roleTag,text:`Rejected ${amt} payout`,detail:(n.note?`Reason: "${n.note}" · `:'')+' Clipper: '+payUser,status:'rejected'};
    return{icon:'💸',who:actorName+roleTag,text:`Updated payout (${o.status||'?'} → ${n.status||'?'})`,detail:amt,status:n.status||'done'};
  }
  if(t==='connected_accounts'){
    const aHandle=n.handle||n.username||o.handle||o.username||'—';const aPlatform=n.platform||o.platform||'—';const aUser=n.user_email||o.user_email||'—';const aReason=n.rejection_reason||'';
    if(n.status==='verified')return{icon:'🔗',who:actorName+roleTag,text:`Verified @${aHandle}'s ${aPlatform} account`,detail:'User: '+aUser,status:'verified'};
    if(n.status==='rejected')return{icon:'🔗',who:actorName+roleTag,text:`Rejected @${aHandle}'s ${aPlatform} account`,detail:aReason?`Reason: "${aReason}"`:'No reason given',status:'rejected'};
    if(action.startsWith('delete'))return{icon:'🗑️',who:actorName+roleTag,text:`Removed @${aHandle}'s ${aPlatform} account`,detail:'',status:'done'};
    return{icon:'🔗',who:actorName+roleTag,text:`Updated @${aHandle}'s ${aPlatform} account`,detail:`${o.status||'?'} → ${n.status||'?'}`,status:n.status||'done'};
  }
  if(t==='campaigns'){
    const title=n.title||o.title||'Untitled';
    if(action.startsWith('insert'))return{icon:'🎬',who:actorName+roleTag,text:`Created campaign "${title}"`,detail:'',status:'done'};
    if(action.startsWith('delete'))return{icon:'🗑️',who:actorName+roleTag,text:`Deleted campaign "${title}"`,detail:'',status:'done'};
    const changes=[];if(o.status!==n.status)changes.push(`${o.status} → ${n.status}`);if(o.title!==n.title)changes.push('title renamed');if(o.rpm!==n.rpm)changes.push(`RPM: ${o.rpm||'—'} → ${n.rpm||'—'}`);
    return{icon:'🎬',who:actorName+roleTag,text:`Updated campaign "${title}"`,detail:changes.join(' · ')||'settings changed',status:'done'};
  }
  if(t==='admin_users'){
    if(action.startsWith('insert'))return{icon:'🛡️',who:actorName+roleTag,text:'Granted admin access',detail:`To: ${n.email||'—'}`,status:'done'};
    return{icon:'🛡️',who:actorName+roleTag,text:'Revoked admin access',detail:`From: ${o.email||'—'}`,status:'done'};
  }
  if(t==='reviewer_users'){
    if(action.startsWith('insert'))return{icon:'🛡️',who:actorName+roleTag,text:'Granted reviewer access',detail:`To: ${n.email||'—'}`,status:'done'};
    return{icon:'🛡️',who:actorName+roleTag,text:'Revoked reviewer access',detail:`From: ${o.email||'—'}`,status:'done'};
  }
  if(t==='access_invites'){
    if(action.startsWith('insert'))return{icon:'✉️',who:actorName+roleTag,text:`Invited ${n.email||'—'} as ${n.role||'—'}`,detail:'',status:n.status||'pending'};
    return{icon:'✉️',who:actorName+roleTag,text:`Updated invite for ${n.email||o.email||'—'}`,detail:n.status||''  ,status:n.status||'done'};
  }
  return{icon:'📋',who:actorName+roleTag,text:action+(t?' on '+t:''  ),detail:'',status:'done'};
  // old start
  if(t==='clip_submissions'){
    if(n.status==='approved')return{icon:'✅',text:`Approved clip — ${n.campaign_title||'Campaign'} (${money(n.earning_amount)})`,status:'approved'};
    if(n.status==='rejected')return{icon:'❌',text:`Rejected clip — ${n.campaign_title||'Campaign'}${n.rejection_reason?' — '+n.rejection_reason:''}`,status:'rejected'};
    if((r.action||'').startsWith('delete'))return{icon:'🗑️',text:`Deleted clip submission — ${o.campaign_title||'Campaign'}`,status:'done'};
    return{icon:'📎',text:`Updated clip — ${n.campaign_title||o.campaign_title||'Campaign'} (${o.status||'?'} → ${n.status||'?'})`,status:n.status||'done'};
  }
  if(t==='payout_requests'){
    if(n.status==='paid')return{icon:'💸',text:`Marked payout paid — ${money(n.amount)}`,status:'paid'};
    if(n.status==='approved')return{icon:'✅',text:`Approved payout — ${money(n.amount)}`,status:'approved'};
    if(n.status==='rejected')return{icon:'❌',text:`Rejected payout — ${money(n.amount)}${n.note?' — '+n.note:''}`,status:'rejected'};
    return{icon:'💸',text:`Updated payout — ${money(n.amount||o.amount)} (${o.status||'?'} → ${n.status||'?'})`,status:n.status||'done'};
  }
  if(t==='connected_accounts'){
    if(n.status==='verified')return{icon:'🔗',text:`Verified account — @${n.handle||n.username||'—'} (${n.platform||'—'})`,status:'verified'};
    if(n.status==='rejected')return{icon:'🔗',text:`Rejected account — @${n.handle||n.username||'—'} (${n.platform||'—'})${n.rejection_reason?' — '+n.rejection_reason:''}`,status:'rejected'};
    if((r.action||'').startsWith('delete'))return{icon:'🗑️',text:`Removed account — @${o.handle||o.username||'—'}`,status:'done'};
    return{icon:'🔗',text:`Updated account — @${n.handle||o.handle||'—'} (${o.status||'?'} → ${n.status||'?'})`,status:n.status||'done'};
  }
  if(t==='campaigns'){
    if((r.action||'').startsWith('insert'))return{icon:'🎬',text:`Created campaign — ${n.title||'Untitled'}`,status:'done'};
    if((r.action||'').startsWith('delete'))return{icon:'🗑️',text:`Deleted campaign — ${o.title||'Untitled'}`,status:'done'};
    return{icon:'🎬',text:`Updated campaign — ${n.title||o.title||'Untitled'}`,status:'done'};
  }
  if(t==='admin_users'){
    if((r.action||'').startsWith('insert'))return{icon:'🛡️',text:`Granted admin access — ${n.email||'—'}`,status:'done'};
    return{icon:'🛡️',text:`Revoked admin access — ${o.email||'—'}`,status:'done'};
  }
  if(t==='reviewer_users'){
    if((r.action||'').startsWith('insert'))return{icon:'🛡️',text:`Granted reviewer access — ${n.email||'—'}`,status:'done'};
    return{icon:'🛡️',text:`Revoked reviewer access — ${o.email||'—'}`,status:'done'};
  }
  if(t==='access_invites'){
    if((r.action||'').startsWith('insert'))return{icon:'✉️',text:`Invited ${n.email||'—'} as ${n.role||'—'}`,status:n.status||'pending'};
    return{icon:'✉️',text:`Invite ${n.email||o.email||'—'} — ${n.status||'updated'}`,status:n.status||'done'};
  }
  return{icon:'📋',text:(r.action||'')+(t?' on '+t:''),status:'done'};
}

window.__logsFilter=function(){
  const p=new URLSearchParams(location.search);
  const actor=(document.getElementById('cx-log-actor')?.value||'').trim();
  const table=document.getElementById('cx-log-table')?.value||'';
  const from=document.getElementById('cx-log-from')?.value||'';
  const to=document.getElementById('cx-log-to')?.value||'';
  if(actor)p.set('la',actor);else p.delete('la');
  if(table)p.set('lt',table);else p.delete('lt');
  if(from)p.set('lfrom',from);else p.delete('lfrom');
  if(to)p.set('lto',to);else p.delete('lto');
  location.search='?'+p.toString();
};
window.__logsClear=function(){location.search='';};

async function renderLogs(){
  const p=new URLSearchParams(location.search);
  const fActor=p.get('la')||'',fTable=p.get('lt')||'',fFrom=p.get('lfrom')||'',fTo=p.get('lto')||'';

  let auditQ=sb.from('v_audit_log_feed').select('*').limit(150);
  if(fActor)auditQ=auditQ.ilike('actor_email','%'+fActor+'%');
  if(fTable)auditQ=auditQ.eq('target_table',fTable);
  if(fFrom)auditQ=auditQ.gte('created_at',fFrom);
  if(fTo)auditQ=auditQ.lte('created_at',fTo+'T23:59:59');
  let audits=[];
  try{const r=await auditQ.order('created_at',{ascending:false});audits=r.data||[];}catch{}

  const allActivity=[];
  try{const{data:subs}=await sb.from('clip_submissions').select('id,user_id,campaign_title,platform,status,created_at,profiles(email,full_name)').order('created_at',{ascending:false}).limit(50);
    (subs||[]).forEach(s=>allActivity.push({ts:s.created_at,icon:'📎',user:s.profiles?.email||'—',action:'Clip submitted — '+( s.campaign_title||'Campaign'),status:s.status,cat:'Submission'}));
  }catch{}
  try{const{data:prs}=await sb.from('payout_requests').select('id,amount,status,requested_at,profiles(email)').order('requested_at',{ascending:false}).limit(30);
    (prs||[]).forEach(p2=>allActivity.push({ts:p2.requested_at,icon:'💸',user:p2.profiles?.email||'—',action:'Withdrawal request — $'+Number(p2.amount).toLocaleString('en-US'),status:p2.status,cat:'Payout'}));
  }catch{}
  try{const{data:accts}=await sb.from('connected_accounts').select('id,platform,handle,status,created_at,profiles(email)').order('created_at',{ascending:false}).limit(30);
    (accts||[]).forEach(a=>allActivity.push({ts:a.created_at,icon:'🔗',user:a.profiles?.email||'—',action:`Account connect — @${a.handle||'—'} (${a.platform||'—'})`,status:a.status,cat:'Account'}));
  }catch{}
  allActivity.sort((a,b)=>new Date(b.ts)-new Date(a.ts));

  const statusColor={approved:'#6EE7B7',paid:'#6EE7B7',verified:'#6EE7B7',rejected:'#F87171',pending:'#FACC15',done:'rgba(255,255,255,.3)',draft:'rgba(255,255,255,.3)'};

  const statusColor2={approved:'#4ade80',paid:'#4ade80',verified:'#4ade80',rejected:'#f87171',edited:'#60a5fa',pending:'#fbbf24',done:'rgba(255,255,255,.32)'};
  const actorColors={admin:'#a5b4fc',reviewer:'#6EE7B7'};
  const auditRows=audits.map(r=>{
    const h=humanizeAudit(r);
    const aColor=actorColors[r.actor_role]||'rgba(255,255,255,.55)';
    return`<tr style="border-bottom:1px solid rgba(255,255,255,.04)">
    <td style="font-size:16px;padding:13px 10px 13px 14px;vertical-align:top">${h.icon}</td>
    <td style="padding:13px 10px;vertical-align:top;white-space:nowrap"><div class="cx-log-who" style="color:${aColor}">${h.who||esc(r.actor_email||'—')}</div></td>
    <td style="padding:13px 10px;vertical-align:top"><div class="cx-log-what">${esc(h.text)}</div>${h.detail?`<div class="cx-log-detail">${esc(h.detail)}</div>`:''}</td>
    <td style="padding:13px 10px;vertical-align:top"><span style="font-size:.62rem;font-weight:700;padding:2px 7px;border-radius:5px;background:rgba(255,255,255,.05);color:rgba(255,255,255,.38);letter-spacing:.04em">${esc(r.target_table||'—')}</span></td>
    <td style="padding:13px 10px;vertical-align:top"><span style="font-size:.7rem;font-weight:700;color:${statusColor2[h.status]||'rgba(255,255,255,.32)'}">${esc(h.status||'—')}</span></td>
    <td style="font-size:11px;color:rgba(255,255,255,.3);padding:13px 14px 13px 10px;vertical-align:top;white-space:nowrap">${r.created_at?new Date(r.created_at).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'—'}</td>
  </tr>`;
  }).join('');

  const actRows=allActivity.slice(0,150).map(r=>`<tr>
    <td style="font-size:14px">${r.icon}</td>
    <td style="font-size:11.5px;color:rgba(255,255,255,.55)">${esc(r.user)}</td>
    <td style="font-size:12px;color:#F5F0EB">${esc(r.action)}</td>
    <td><span style="font-size:.65rem;font-weight:700;padding:2px 7px;border-radius:10px;background:rgba(255,255,255,.06);color:rgba(255,255,255,.45)">${esc(r.cat)}</span></td>
    <td><span style="font-size:.68rem;font-weight:600;color:${statusColor[r.status]||'rgba(255,255,255,.3)'}">${esc(r.status||'—')}</span></td>
    <td style="font-size:11px;color:rgba(255,255,255,.35)">${r.ts?new Date(r.ts).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'—'}</td>
  </tr>`).join('');

  const tableOptions=['','clip_submissions','payout_requests','connected_accounts','campaigns','admin_users','reviewer_users','access_invites'];
  const inputStyle='background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:8px 12px;color:#F5F0EB;font-size:12px';

  return page({kicker:'System Logs',title:'Activity & Logs.',sub:'Who did what — every admin and reviewer action, filterable.',
    body:`<div class="cx-sec">
    <div class="cx-sh" style="margin-bottom:14px"><div><div class="cx-st">Staff actions</div><div class="cx-sd">${audits.length} actions by admins & reviewers</div></div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      <input id="cx-log-actor" placeholder="Filter by actor email..." value="${esc(fActor)}" style="${inputStyle};min-width:200px">
      <select id="cx-log-table" style="${inputStyle}">
        ${tableOptions.map(t=>`<option value="${esc(t)}" ${t===fTable?'selected':''}>${t?esc(t):'All tables'}</option>`).join('')}
      </select>
      <input id="cx-log-from" type="date" value="${esc(fFrom)}" style="${inputStyle}">
      <input id="cx-log-to" type="date" value="${esc(fTo)}" style="${inputStyle}">
      <button class="cx-btn" onclick="window.__logsFilter()">Apply</button>
      <button class="cx-btn ghost" onclick="window.__logsClear()">Clear</button>
    </div>
    <div class="cx-tw" style="margin-bottom:28px"><table class="cx-t">
      <thead><tr><th></th><th>Actor</th><th>Action</th><th>Table</th><th>Status</th><th>Time</th></tr></thead>
      <tbody>${auditRows||'<tr><td colspan="6"><div class="cx-empty">No staff actions match these filters.</div></td></tr>'}</tbody>
    </table></div>
    <div class="cx-sh" style="margin-bottom:12px"><div><div class="cx-st">User activity</div><div class="cx-sd">${allActivity.length} submissions, payout requests & account connects</div></div></div>
    <div class="cx-tw"><table class="cx-t">
      <thead><tr><th></th><th>User</th><th>Action</th><th>Category</th><th>Status</th><th>Time</th></tr></thead>
      <tbody>${actRows||'<tr><td colspan="6"><div class="cx-empty">No activity yet.</div></td></tr>'}</tbody>
    </table></div></div>`});
}

/* ══ ANALYTICS ═══════════════════════════════════════════════════════ */
async function renderAnalytics(){
  const fmtSec=s=>{if(!s)return'—';const m=Math.floor(s/60);const h=Math.floor(m/60);return h>0?h+'h '+(m%60)+'m':m>0?m+'m':'<1m';};
  let k={},sessions=[],campaigns=[],clippers=[],reviewers=[],payouts=[],daily=[];
  try{const{data,error}=await sb.from('v_admin_kpis').select('*').single();if(!error)k=data||{};}catch{}
  try{const r=await sb.from('user_session_logs').select('id,email,display_name,login_at,last_seen_at,status,entry_path,total_seconds').order('login_at',{ascending:false}).limit(30);sessions=r.data||[];}catch{}
  try{const r=await sb.from('v_campaign_performance').select('*').limit(50);campaigns=r.data||[];}catch{}
  try{const r=await sb.from('v_top_clippers').select('*').limit(15);clippers=r.data||[];}catch{}
  try{const r=await sb.from('v_reviewer_throughput').select('*').limit(15);reviewers=r.data||[];}catch{}
  try{const r=await sb.from('v_payout_summary').select('*');payouts=r.data||[];}catch{}
  try{const r=await sb.from('v_daily_activity').select('*').limit(30);daily=r.data||[];}catch{}

  const cards=[
    ['Active Campaigns',fmt(k.active_campaigns||0),'of '+fmt(k.total_campaigns||0)+' total','ok'],
    ['Pending Review',fmt(k.clips_pending_review||0),'Clips awaiting review','warn'],
    ['Approved Views',fmt(k.total_approved_views||0),'Across approved clips','info'],
    ['Earnings Accrued',fmtMoney(k.total_earnings_accrued||0),'Total clipper earnings',''],
    ['Payouts Pending',fmt(k.payouts_pending||0),fmtMoney(k.payouts_pending_amount||0)+' requested','warn'],
    ['Payouts Paid',fmtMoney(k.payouts_paid_amount||0),'Lifetime processed','ok'],
    ['Accounts Pending',fmt(k.accounts_pending_verification||0),'Awaiting verification','warn'],
    ['Active Sessions',fmt(k.sessions_active_now||0),'Right now','info'],
    ['Logins (24h)',fmt(k.logins_last_24h||0),'Last 24 hours',''],
    ['DAU (7d)',fmt(k.dau_7d||0),'Unique users, last 7 days','info'],
    ['Total Clippers',fmt(k.total_clippers||0),'Registered','ok'],
    ['Total Brands',fmt(k.total_brands||0),'Registered',''],
  ].map(([l,v,s2,cls])=>`<div class="cx-stat ${cls}"><div class="cx-stat-l">${l}</div><div class="cx-stat-v">${v}</div><div class="cx-stat-s">${s2}</div></div>`).join('');

  const campaignStatusColor={active:'#6EE7B7',paused:'#FACC15',completed:'rgba(255,255,255,.4)',draft:'rgba(255,255,255,.3)'};
  const campaignRows=campaigns.map(c=>`<tr>
    <td style="font-size:12px;font-weight:600">${esc(c.title||'Untitled')}</td>
    <td><span style="font-size:.68rem;font-weight:600;color:${campaignStatusColor[c.status]||'rgba(255,255,255,.4)'}">${esc(c.status||'—')}</span></td>
    <td style="font-size:12px;color:rgba(255,255,255,.7)">${fmt(c.total_submissions||0)}</td>
    <td style="font-size:12px;color:#6EE7B7">${fmt(c.approved_submissions||0)}</td>
    <td style="font-size:12px;color:#F87171">${fmt(c.rejected_submissions||0)}</td>
    <td style="font-size:12px;color:#FACC15">${fmt(c.pending_submissions||0)}</td>
    <td style="font-size:12px;color:rgba(255,255,255,.85)">${fmt(c.total_views||0)}</td>
    <td style="font-size:12px;font-weight:600;color:#C4956A">${fmtMoney(c.total_earnings||0)}</td>
    <td style="font-size:12px;color:rgba(255,255,255,.7)">${c.approval_rate_pct!=null?c.approval_rate_pct+'%':'—'}</td>
    <td style="font-size:12px;color:rgba(255,255,255,.7)">${fmt(c.unique_clippers||0)}</td>
  </tr>`).join('');

  const clipperRows=clippers.map(c=>`<tr>
    <td style="font-size:12px;font-weight:600">${esc(c.name||c.email||'—')}</td>
    <td style="font-size:12px;color:rgba(255,255,255,.7)">${fmt(c.total_submissions||0)}</td>
    <td style="font-size:12px;color:#6EE7B7">${fmt(c.approved_submissions||0)}</td>
    <td style="font-size:12px;color:rgba(255,255,255,.85)">${fmt(c.total_views||0)}</td>
    <td style="font-size:12px;font-weight:600;color:#C4956A">${fmtMoney(c.total_earnings||0)}</td>
    <td style="font-size:12px;color:rgba(255,255,255,.7)">${fmt(c.campaigns_participated||0)}</td>
  </tr>`).join('');

  const reviewerRows=reviewers.map(r=>`<tr>
    <td style="font-size:12px;font-weight:600">${esc(r.reviewer||'—')}</td>
    <td style="font-size:12px;color:rgba(255,255,255,.7)">${fmt(r.total_reviewed||0)}</td>
    <td style="font-size:12px;color:#6EE7B7">${fmt(r.approved||0)}</td>
    <td style="font-size:12px;color:#F87171">${fmt(r.rejected||0)}</td>
    <td style="font-size:12px;color:rgba(255,255,255,.7)">${r.avg_review_time_hours!=null?r.avg_review_time_hours+'h':'—'}</td>
  </tr>`).join('');

  const payoutStatusColor={pending:'#FACC15',approved:'#60A5FA',paid:'#6EE7B7',rejected:'#F87171'};
  const payoutRows=payouts.map(p=>`<tr>
    <td><span style="font-size:.68rem;font-weight:600;color:${payoutStatusColor[p.status]||'rgba(255,255,255,.4)'}">${esc(p.status||'—')}</span></td>
    <td style="font-size:12px;color:rgba(255,255,255,.7)">${fmt(p.count||0)}</td>
    <td style="font-size:12px;font-weight:600;color:#C4956A">${fmtMoney(p.total_amount||0)}</td>
    <td style="font-size:12px;color:rgba(255,255,255,.7)">${p.avg_turnaround_hours!=null?p.avg_turnaround_hours+'h':'—'}</td>
  </tr>`).join('');

  const dailyRows=daily.map(d=>`<tr>
    <td style="font-size:11px;color:rgba(255,255,255,.6)">${d.day?new Date(d.day).toLocaleDateString('en-IN',{day:'numeric',month:'short'}):'—'}</td>
    <td style="font-size:12px">${fmt(d.new_signups||0)}</td>
    <td style="font-size:12px">${fmt(d.submissions||0)}</td>
    <td style="font-size:12px;color:#6EE7B7">${fmt(d.approvals||0)}</td>
    <td style="font-size:12px;color:#F87171">${fmt(d.rejections||0)}</td>
    <td style="font-size:12px">${fmt(d.views_submitted||0)}</td>
    <td style="font-size:12px">${fmt(d.payout_requests||0)}</td>
    <td style="font-size:12px;color:#C4956A">${fmtMoney(d.amount_paid||0)}</td>
    <td style="font-size:12px">${fmt(d.active_users||0)}</td>
  </tr>`).join('');

  const sessionRows=sessions.map(r=>`<tr>
    <td><div style="font-size:12px;font-weight:600">${esc(r.display_name||r.email||'—')}</div><div style="font-size:10.5px;color:rgba(255,255,255,.35)">${esc(r.email||'')}</div></td>
    <td><span class="cx-badge ${r.status==='active'?'approved':'draft'}">${esc(r.status||'offline')}</span></td>
    <td style="font-size:11px;color:rgba(255,255,255,.45)">${r.login_at?new Date(r.login_at).toLocaleString('en-US'):'—'}</td>
    <td style="font-size:11px;color:rgba(255,255,255,.45)">${r.last_seen_at?new Date(r.last_seen_at).toLocaleString('en-US'):'—'}</td>
    <td style="font-size:12px;font-weight:600;color:#C4956A">${fmtSec(r.total_seconds)}</td>
    <td style="font-size:10.5px;color:rgba(255,255,255,.3)">${esc(r.entry_path||'—')}</td>
  </tr>`).join('');

  return page({kicker:'Platform Analytics',title:'Analytics.',sub:'Live KPIs across campaigns, clips, payouts and sessions.',
    body:`<div class="cx-stats">${cards}</div>
    <div class="cx-sec">
    <div class="cx-sh" style="margin-bottom:12px"><div><div class="cx-st">Campaign performance</div><div class="cx-sd">${campaigns.length} campaigns ranked by earnings</div></div></div>
    <div class="cx-tw" style="margin-bottom:28px"><table class="cx-t">
      <thead><tr><th>Campaign</th><th>Status</th><th>Submissions</th><th>Approved</th><th>Rejected</th><th>Pending</th><th>Views</th><th>Earnings</th><th>Approval %</th><th>Clippers</th></tr></thead>
      <tbody>${campaignRows||'<tr><td colspan="10"><div class="cx-empty">No campaign data yet.</div></td></tr>'}</tbody>
    </table></div>
    <div class="cx-sh" style="margin-bottom:12px"><div><div class="cx-st">Top clippers</div><div class="cx-sd">${clippers.length} ranked by earnings</div></div></div>
    <div class="cx-tw" style="margin-bottom:28px"><table class="cx-t">
      <thead><tr><th>Clipper</th><th>Submissions</th><th>Approved</th><th>Views</th><th>Earnings</th><th>Campaigns</th></tr></thead>
      <tbody>${clipperRows||'<tr><td colspan="6"><div class="cx-empty">No data yet.</div></td></tr>'}</tbody>
    </table></div>
    <div class="cx-sh" style="margin-bottom:12px"><div><div class="cx-st">Reviewer throughput</div><div class="cx-sd">${reviewers.length} reviewers</div></div></div>
    <div class="cx-tw" style="margin-bottom:28px"><table class="cx-t">
      <thead><tr><th>Reviewer</th><th>Reviewed</th><th>Approved</th><th>Rejected</th><th>Avg time</th></tr></thead>
      <tbody>${reviewerRows||'<tr><td colspan="5"><div class="cx-empty">No reviews yet.</div></td></tr>'}</tbody>
    </table></div>
    <div class="cx-sh" style="margin-bottom:12px"><div><div class="cx-st">Payout summary</div><div class="cx-sd">By status</div></div></div>
    <div class="cx-tw" style="margin-bottom:28px"><table class="cx-t">
      <thead><tr><th>Status</th><th>Count</th><th>Total</th><th>Avg turnaround</th></tr></thead>
      <tbody>${payoutRows||'<tr><td colspan="4"><div class="cx-empty">No payouts yet.</div></td></tr>'}</tbody>
    </table></div>
    <div class="cx-sh" style="margin-bottom:12px"><div><div class="cx-st">Daily activity</div><div class="cx-sd">Last 30 days</div></div></div>
    <div class="cx-tw" style="margin-bottom:28px"><table class="cx-t">
      <thead><tr><th>Day</th><th>Signups</th><th>Submissions</th><th>Approved</th><th>Rejected</th><th>Views</th><th>Payout Reqs</th><th>Paid</th><th>Active</th></tr></thead>
      <tbody>${dailyRows||'<tr><td colspan="9"><div class="cx-empty">No data yet.</div></td></tr>'}</tbody>
    </table></div>
    <div class="cx-sh" style="margin-bottom:12px"><div><div class="cx-st">User sessions</div><div class="cx-sd">${sessions.length} sessions tracked</div></div></div>
    <div class="cx-tw"><table class="cx-t">
      <thead><tr><th>User</th><th>Status</th><th>Login</th><th>Last seen</th><th>Duration</th><th>Entry</th></tr></thead>
      <tbody>${sessionRows||'<tr><td colspan="6"><div class="cx-empty">No sessions.</div></td></tr>'}</tbody>
    </table></div>
    </div>`});
}


async function renderLeads(){
  const tab=new URLSearchParams(location.search).get('tab')||'new';
  const{data:rows,error}=await sb.from('leads').select('*').order('created_at',{ascending:false});
  if(error){return page({kicker:'Leads',title:'Leads.',sub:'Brand inquiries.',body:`<div class="cx-empty">Error: ${esc(error.message)}</div>`});}
  const all=rows||[];
  const filtered=tab==='all'?all:all.filter(r=>r.status===tab);
  const counts={new:all.filter(r=>r.status==='new').length,contacted:all.filter(r=>r.status==='contacted').length,qualified:all.filter(r=>r.status==='qualified').length,closed:all.filter(r=>r.status==='closed').length,all:all.length};
  const tabs=['new','contacted','qualified','closed','all'].map(t=>`<button class="cx-tab${tab===t?' on':''}" onclick="location.search='?tab=${t}'">${t[0].toUpperCase()+t.slice(1)} <span style="opacity:.5;font-size:.75em">${counts[t]||0}</span></button>`).join('');
  const sc={new:'#fbbf24',contacted:'#a5b4fc',qualified:'#4ade80',closed:'rgba(255,255,255,.3)'};
  const rowsHtml=filtered.length?`<div class="cx-tw"><table class="cx-t">
    <thead><tr><th>Name</th><th>Email</th><th>Company</th><th>Type</th><th>Budget</th><th>Message</th><th>Status</th><th>Date</th><th>Update</th></tr></thead>
    <tbody>${filtered.map(r=>`<tr>
      <td style="font-weight:600;white-space:nowrap">${esc(r.full_name||'—')}</td>
      <td style="font-size:12px"><a href="mailto:${esc(r.email||'')}" style="color:#a5b4fc;text-decoration:none">${esc(r.email||'—')}</a>${r.phone?`<div style="font-size:10.5px;color:rgba(255,255,255,.35)">${esc(r.phone)}</div>`:''}</td>
      <td style="font-size:12px">${esc(r.company||r.brand_name||'—')}</td>
      <td><span style="font-size:11px;background:rgba(99,102,241,.12);color:#a5b4fc;padding:2px 8px;border-radius:10px">${esc(r.campaign_type||'—')}</span></td>
      <td style="font-size:12px;font-weight:600;color:#4ade80">${esc(r.budget||'—')}</td>
      <td style="font-size:11.5px;color:rgba(255,255,255,.5);max-width:180px"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px" title="${esc(r.message||'')}">${esc((r.message||'—').slice(0,60))}${(r.message||'').length>60?'…':''}</div></td>
      <td><span class="cx-badge" style="color:${sc[r.status]||sc.new};background:${sc[r.status]||sc.new}22">${esc(r.status||'new')}</span></td>
      <td style="font-size:11px;color:rgba(255,255,255,.35)">${fmtDate(r.created_at)}</td>
      <td><select style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#f5f5f7;font-size:11.5px;padding:4px 8px;cursor:pointer;font-family:inherit" onchange="updateLeadStatus('${esc(r.id)}',this.value)">
        ${['new','contacted','qualified','closed'].map(s=>`<option value="${s}"${r.status===s?' selected':''}>${s[0].toUpperCase()+s.slice(1)}</option>`).join('')}
      </select></td>
    </tr>`).join('')}</tbody>
  </table></div>`:`<div class="cx-empty">No ${tab} leads.</div>`;
  return page({kicker:'Lead Pipeline',title:'Leads.',sub:'Brand & creator inquiries from the landing page.',
    body:`<div class="cx-sec">
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:18px">
      ${['new','contacted','qualified','closed','all'].map(t=>`<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:12px 14px;text-align:center"><div style="font-family:monospace;font-size:.48rem;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:5px">${t}</div><div style="font-size:1.5rem;font-weight:800;color:${sc[t]||'#f5f5f7'}">${counts[t]||0}</div></div>`).join('')}
    </div>
    <div class="cx-sh"><div><div class="cx-st">Inquiries</div><div class="cx-sd">${filtered.length} in "${tab}"</div></div></div>
    <div class="cx-tabs">${tabs}</div>${rowsHtml}</div>`});
}
window.updateLeadStatus=async function(id,status){
  await sb.from('leads').update({status,updated_at:new Date().toISOString()}).eq('id',id);
};


function parseReqsForEdit(raw){
  if(!raw) return '';
  let text=raw;
  // Unwrap any remaining JSON
  for(let i=0;i<10;i++){
    try{
      const p=JSON.parse(text);
      if(Array.isArray(p)){text=p.join('\n');continue;}
      if(typeof p==='string'){text=p;continue;}
    }catch(e){break;}
    break;
  }
  return text;
}
function saveReqsFromEdit(text){
  // Store as plain newline-separated text — no JSON encoding
  return (text||'').split('\n').map(s=>s.trim()).filter(Boolean).join('\n');
}

function renderRestricted(){
  return`<div style="min-height:100vh;display:grid;place-items:center;background:#000;color:#f5f5f7;font-family:-apple-system,sans-serif"><div style="text-align:center;max-width:440px;padding:32px"><div style="color:#6366f1;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:14px">Access Denied</div><h1 style="font-size:36px;font-weight:700;margin-bottom:10px">Reviewer access.</h1><p style="color:rgba(255,255,255,.5);margin-bottom:24px">Your reviewer account can only access Accounts and Reviews.</p><a href="/admin/reviews" style="background:#6366f1;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:600;margin-right:10px">Go to Reviews</a><a href="/admin/connected-accounts" style="background:rgba(255,255,255,.08);color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:600">Go to Accounts</a></div></div>`;
}


/* ══ CLIENTS ════════════════════════════════════════════════════════
   Client logins are created here and nowhere else — there is no client
   signup. A client sees a campaign only when it is linked to them, so an
   account with nothing linked sees an empty dashboard, by design.
═══════════════════════════════════════════════════════════════════════ */
async function renderClients(){
  /* Reads profiles + campaigns directly, exactly like renderUsers() and
     renderPayouts() do. It used to call a bespoke admin_list_clients() RPC,
     which left the page on a spinner forever — a brand new function is not
     visible to PostgREST until its schema cache reloads, and there is no
     reason to depend on one when staff can already read these tables.
     Everything is time-boxed so this page can never hang again. */
  const guard = (p, label) => Promise.race([
    p,
    new Promise(res => setTimeout(() => res({data:null, error:{message:label+' timed out after 10s'}}), 10000))
  ]);

  let profs=[], camps=[], err=null;
  try{
    const [pr, cr] = await Promise.all([
      guard(sb.from('profiles')
              .select('id,email,full_name,company_name,role,created_at')
              .eq('role','client')
              .order('created_at',{ascending:false}), 'Loading clients'),
      guard(sb.from('campaigns')
              .select('id,title,status,client_user_id')
              .order('title'), 'Loading campaigns')
    ]);
    if(pr.error) throw new Error(pr.error.message);
    if(cr.error) throw new Error(cr.error.message);
    profs = pr.data||[];
    camps = cr.data||[];
  }catch(e){ err = e; }

  if(err) return page({kicker:'Client Access',title:'Clients.',
    sub:'Could not load client accounts.',
    body:`<div class="cx-sec"><div class="cx-empty">${esc(err.message||String(err))}<br>
      <span style="font-size:.78rem;opacity:.7">If this mentions permission, your login is not staff.</span></div></div>`});

  const list = profs.map(p=>({
    user_id:p.id, email:p.email, full_name:p.full_name,
    company_name:p.company_name, created_at:p.created_at
  }));
  const all = camps;
  const unlinked = all.filter(c=>!c.client_user_id);

  const rows = list.length ? `<div class="cx-tw"><table class="cx-table">
    <thead><tr><th>Client</th><th>Email</th><th>Company</th><th>Campaigns</th><th>Added</th><th>Actions</th></tr></thead>
    <tbody>${list.map(c=>{
      const mine = all.filter(x=>x.client_user_id===c.user_id);
      return `<tr>
        <td><b>${esc(c.full_name||'—')}</b></td>
        <td style="font-family:'Space Mono',monospace;font-size:.75rem;">${esc(c.email||'—')}</td>
        <td>${esc(c.company_name||'—')}</td>
        <td>${mine.length
              ? mine.map(m=>`<span class="cx-badge active">${esc(m.title)}</span>`).join(' ')
              : '<span style="color:#F87171;font-size:.78rem;">none — dashboard will be empty</span>'}</td>
        <td style="font-size:.75rem;color:#6A6158;">${fmtDate(c.created_at)}</td>
        <td><button class="cx-btn" data-client-link="${esc(c.user_id)}" data-client-email="${esc(c.email||'')}">Campaigns</button></td>
      </tr>`;}).join('')}</tbody></table></div>`
    : `<div class="cx-empty">No client accounts yet. Create one to give a brand access to its own dashboard.</div>`;

  return page({kicker:'Client Access',title:'Clients.',
    sub:'Create a client login and choose which campaigns it can see. Clients cannot sign up themselves.',
    body:`<div class="cx-sec">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px">
        ${[['Clients',list.length,'#6EE7B7'],
           ['Campaigns linked',all.length-unlinked.length,'#F5F0EB'],
           ['Campaigns unassigned',unlinked.length,unlinked.length?'#FACC15':'#6A6158']]
          .map(([l,v,col])=>`<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:14px 16px;text-align:center"><div style="font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.35);margin-bottom:6px">${l}</div><div style="font-size:1.6rem;font-weight:800;color:${col}">${v}</div></div>`).join('')}
      </div>
      <div class="cx-sh"><div><div class="cx-st">Client accounts</div><div class="cx-sd">${list.length} account${list.length!==1?'s':''}</div></div>
        <button class="cx-btn ok" id="cx-new-client">+ New client</button></div>
      ${rows}
    </div>`});
}

/* Create a client login. Password is set by staff — the account is handed over,
   not self-registered. */
window.showClientForm=function(){
  const panel=document.createElement('div');
  panel.className='cx-panel';
  panel.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);backdrop-filter:blur(6px);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px;';
  panel.innerHTML=`<div style="background:#181410;border:1px solid rgba(196,149,106,.2);border-radius:18px;width:100%;max-width:520px;padding:28px;max-height:90vh;overflow-y:auto;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:18px;">
      <div><div style="font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.16em;text-transform:uppercase;color:#C4956A;margin-bottom:5px;">New Client</div>
      <h3 style="font-family:'Instrument Serif',serif;font-size:1.4rem;color:#F5F0EB;font-weight:400;">Create a client login</h3></div>
      <button onclick="this.closest('.cx-panel').remove()" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#B8AFA8;width:32px;height:32px;border-radius:7px;cursor:pointer;">✕</button>
    </div>
    <div id="cf-err" style="margin-bottom:10px;"></div>
    <label class="cx-lbl">Email *</label><input class="cx-input" id="cf-email" type="email" placeholder="brand@company.com"/>
    <label class="cx-lbl">Password *</label><input class="cx-input" id="cf-pass" type="text" placeholder="at least 8 characters"/>
    <div style="font-size:.72rem;color:#6A6158;margin:-8px 0 14px;">Shown as plain text on purpose — you have to pass it to the client.</div>
    <label class="cx-lbl">Contact name</label><input class="cx-input" id="cf-name" placeholder="Tal"/>
    <label class="cx-lbl">Company</label><input class="cx-input" id="cf-co" placeholder="Tal's Pod"/>
    <label class="cx-lbl">Campaigns they can see</label>
    <div id="cf-camps" style="max-height:180px;overflow-y:auto;border:1px solid rgba(255,255,255,.1);border-radius:9px;padding:10px 12px;margin-bottom:16px;font-size:.85rem;">Loading…</div>
    <div style="display:flex;gap:9px;padding-top:12px;border-top:1px solid rgba(255,255,255,.06);">
      <button id="cf-save" class="cx-btn ok" style="flex:1;justify-content:center;">Create client</button>
      <button onclick="this.closest('.cx-panel').remove()" class="cx-btn ghost">Cancel</button>
    </div>
  </div>`;
  (document.getElementById('cxos')||document.body).appendChild(panel);

  sb.from('campaigns').select('id,title,status,client_user_id').order('title').then(({data})=>{
    const box=panel.querySelector('#cf-camps');
    if(!data||!data.length){box.textContent='No campaigns exist yet.';return;}
    box.innerHTML=data.map(c=>`<label style="display:flex;align-items:center;gap:9px;padding:5px 0;cursor:pointer;">
      <input type="checkbox" value="${esc(c.id)}" ${c.client_user_id?'disabled':''}/>
      <span style="flex:1;${c.client_user_id?'opacity:.45':''}">${esc(c.title)}</span>
      <span style="font-size:.7rem;color:#6A6158;">${c.client_user_id?'already assigned':esc(c.status||'')}</span>
    </label>`).join('');
  });

  panel.querySelector('#cf-save').onclick=async()=>{
    const err=panel.querySelector('#cf-err');
    const email=panel.querySelector('#cf-email').value.trim();
    const pass=panel.querySelector('#cf-pass').value;
    const ids=[...panel.querySelectorAll('#cf-camps input:checked')].map(i=>i.value);
    const fail=t=>{err.innerHTML=`<div style="color:#F87171;font-size:.8rem;">${esc(t)}</div>`;};
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))return fail('Enter a valid email address.');
    if(pass.length<8)return fail('Password must be at least 8 characters.');
    const btn=panel.querySelector('#cf-save');btn.disabled=true;btn.textContent='Creating…';
    try{
      const r=await sb.functions.invoke('admin-create-client',{body:{
        email,password:pass,
        full_name:panel.querySelector('#cf-name').value.trim(),
        company_name:panel.querySelector('#cf-co').value.trim(),
        campaign_ids:ids
      }});
      if(r.error){
        let m='';try{m=(await r.error.context.json()).error||'';}catch(_){}
        throw new Error(m||r.error.message||'Could not create the client.');
      }
      const d=r.data||{};
      panel.remove();
      toast(`✓ ${email} created · ${d.campaigns_linked||0} campaign${d.campaigns_linked===1?'':'s'} linked`+(d.reused_existing?' (existing account reused)':''),'ok');
      await boot();
    }catch(e){fail(e.message);btn.disabled=false;btn.textContent='Create client';}
  };
};

/* Re-assign which campaigns an existing client can see. */
window.showClientCampaigns=async function(userId,email){
  const{data}=await sb.from('campaigns').select('id,title,status,client_user_id').order('title');
  const panel=document.createElement('div');
  panel.className='cx-panel';
  panel.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);backdrop-filter:blur(6px);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px;';
  panel.innerHTML=`<div style="background:#181410;border:1px solid rgba(196,149,106,.2);border-radius:18px;width:100%;max-width:520px;padding:28px;max-height:90vh;overflow-y:auto;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;">
      <div><div style="font-family:'Space Mono',monospace;font-size:.5rem;letter-spacing:.16em;text-transform:uppercase;color:#C4956A;margin-bottom:5px;">Campaign Access</div>
      <h3 style="font-family:'Instrument Serif',serif;font-size:1.3rem;color:#F5F0EB;font-weight:400;">${esc(email||'Client')}</h3></div>
      <button onclick="this.closest('.cx-panel').remove()" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#B8AFA8;width:32px;height:32px;border-radius:7px;cursor:pointer;">✕</button>
    </div>
    <div style="font-size:.76rem;color:#6A6158;margin-bottom:14px;line-height:1.5;">Ticked campaigns appear on this client's dashboard. Greyed-out ones belong to another client.</div>
    <div id="cc-list" style="max-height:300px;overflow-y:auto;border:1px solid rgba(255,255,255,.1);border-radius:9px;padding:10px 12px;margin-bottom:16px;font-size:.85rem;">
      ${(data||[]).map(c=>{
        const mine=c.client_user_id===userId, other=c.client_user_id&&!mine;
        return `<label style="display:flex;align-items:center;gap:9px;padding:5px 0;${other?'opacity:.4;':'cursor:pointer;'}">
          <input type="checkbox" value="${esc(c.id)}" ${mine?'checked':''} ${other?'disabled':''}/>
          <span style="flex:1;">${esc(c.title)}</span>
          <span style="font-size:.7rem;color:#6A6158;">${other?'another client':esc(c.status||'')}</span>
        </label>`;}).join('')||'No campaigns.'}
    </div>
    <div id="cc-err" style="margin-bottom:8px;"></div>
    <div style="display:flex;gap:9px;padding-top:12px;border-top:1px solid rgba(255,255,255,.06);">
      <button id="cc-save" class="cx-btn ok" style="flex:1;justify-content:center;">Save access</button>
      <button onclick="this.closest('.cx-panel').remove()" class="cx-btn ghost">Cancel</button>
    </div>
  </div>`;
  (document.getElementById('cxos')||document.body).appendChild(panel);

  panel.querySelector('#cc-save').onclick=async()=>{
    const btn=panel.querySelector('#cc-save');btn.disabled=true;btn.textContent='Saving…';
    const boxes=[...panel.querySelectorAll('#cc-list input:not(:disabled)')];
    try{
      /* One call per campaign: admin_set_campaign_client is staff-guarded in
         the database, so the check cannot be skipped from the browser. */
      for(const b of boxes){
        const wasMine=(data||[]).find(c=>c.id===b.value)?.client_user_id===userId;
        if(b.checked===wasMine) continue;
        const{error}=await sb.rpc('admin_set_campaign_client',{
          p_campaign_id:b.value, p_user_id: b.checked?userId:null});
        if(error)throw error;
      }
      panel.remove();toast('✓ Campaign access updated','ok');await boot();
    }catch(e){
      panel.querySelector('#cc-err').innerHTML=`<div style="color:#F87171;font-size:.8rem;">${esc(e.message)}</div>`;
      btn.disabled=false;btn.textContent='Save access';
    }
  };
};

async function renderRoute(){
  try{ return await renderRouteInner(); }
  catch(e){
    console.error('[cxos] route failed',e);
    return page({kicker:'Error',title:'Something broke on this page.',
      sub:'The rest of Admin OS still works — use the sidebar.',
      body:`<div class="cx-sec"><div class="cx-empty">${esc(e&&e.message||String(e))}</div></div>`});
  }
}
async function renderRouteInner(){
  const REVIEWER_ALLOWED=['/admin/connected-accounts','/admin/accounts','/admin/reviews','/admin/review'];
  if(myRole==='reviewer'&&!REVIEWER_ALLOWED.includes(PATH))return renderRestricted();
  if(PATH==='/admin'||PATH==='/workspace')return renderCommand();
  if(PATH==='/admin/connected-accounts'||PATH==='/admin/accounts')return renderAccounts();
  if(PATH==='/admin/campaigns')return renderCampaigns();
  if(PATH==='/admin/reviews'||PATH==='/admin/review')return renderReviews();
  if(PATH==='/admin/payouts')return renderPayouts();
  if(PATH==='/admin/analytics')return renderAnalytics();
  if(PATH==='/admin/logs')return renderLogs();
  if(PATH==='/admin/leads')return renderLeads();
  if(PATH==='/admin/users')return renderUsers();
  if(PATH==='/admin/clients')return renderClients();
  return renderCommand();
}

/* ══ EVENTS ═════════════════════════════════════════════════════════ */
function bindEvents(){
  document.getElementById('cx-logout')?.addEventListener('click',async()=>{
    try{await sb.auth.signOut({scope:'global'});}catch{}
    window.location.replace('/login');
  });
  // New campaign
  document.getElementById('cx-new-campaign')?.addEventListener('click',()=>window.showCampaignForm(null));
  // Clients
  document.getElementById('cx-new-client')?.addEventListener('click',()=>window.showClientForm());
  document.querySelectorAll('[data-client-link]').forEach(btn=>{
    btn.addEventListener('click',()=>window.showClientCampaigns(btn.dataset.clientLink,btn.dataset.clientEmail));
  });
  // Edit campaign — fetch from Supabase by id to avoid CSP eval
  document.querySelectorAll('[data-camp-edit]').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      const id=btn.dataset.campEdit;
      const{data}=await sb.from('campaigns').select('*').eq('id',id).maybeSingle();
      if(data)showCampaignForm(data);
    });
  });
  // Approve account
  document.querySelectorAll('[data-approve-acct]').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      if(!confirm('Approve this account?'))return;
      btn.disabled=true;btn.textContent='Approving…';
      const{error}=await sb.rpc('admin_approve_account',{p_id:btn.dataset.approveAcct});
      if(error){alert(error.message);btn.disabled=false;btn.textContent='Approve';return;}
      await boot();
    });
  });
  // Reject account
  document.querySelectorAll('[data-reject-acct]').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      await showModal({title:'Reject Account',desc:'Provide a reason so the clipper knows what to fix.',
        fields:[{key:'reason',label:'Rejection reason',placeholder:'e.g. Code not found in bio',required:true,type:'textarea'}],
        confirmLabel:'Reject',confirmClass:'danger',
        onConfirm:async({reason})=>{
          const{error}=await sb.rpc('admin_reject_account',{p_id:btn.dataset.rejectAcct,p_reason:reason});
          if(error)throw error;
          await boot();
        }
      });
    });
  });
  // Approve/reject handled via openReviewModal onclick
  // Reject submission
  document.querySelectorAll('[data-reject-sub]').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      await showModal({title:'Reject Submission',desc:'Provide a clear reason so the clipper can resubmit if applicable.',
        fields:[{key:'reason',label:'Rejection reason',placeholder:'e.g. Clip URL not working, views not matching',required:true,type:'textarea'}],
        confirmLabel:'Reject',confirmClass:'danger',
        onConfirm:async({reason})=>{
          const{error}=await sb.rpc('admin_reject_submission',{p_id:btn.dataset.rejectSub,p_reason:reason});
          if(error)throw error;
          await boot();
        }
      });
    });
  });
  // Mark payout paid
  document.querySelectorAll('[data-pay]').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      await showModal({title:'Mark as Paid',desc:'Enter a transaction reference (UPI ID, UTR number, etc.) for your records.',
        fields:[{key:'ref',label:'Transaction reference (optional)',placeholder:'e.g. UTR123456789',type:'text'}],
        confirmLabel:'Mark as Paid',confirmClass:'ok',
        onConfirm:async({ref})=>{
          const{error}=await sb.rpc('admin_process_payout',{p_id:btn.dataset.pay,p_ref:ref||null});
          if(error)throw error;
          await boot();
        }
      });
    });
  });
  // Role save
  document.getElementById('cx-role-save')?.addEventListener('click',async()=>{
    const email=document.getElementById('cx-role-email')?.value?.trim();
    const role=document.getElementById('cx-role-select')?.value;
    const btn=document.getElementById('cx-role-save');
    if(!email||!email.includes('@'))return alert('Enter a valid email.');
    btn.disabled=true;btn.textContent='Saving…';
    try{
      if(role==='admin'){
        await sb.from('admin_users').upsert({email},{onConflict:'email'});
        await sb.from('reviewer_users').delete().eq('email',email);
      }else{
        await sb.from('reviewer_users').upsert({email},{onConflict:'email'});
        await sb.from('admin_users').delete().eq('email',email);
      }
      await boot();
    }catch(e){alert(e.message||'Error');btn.disabled=false;btn.textContent='Save access';}
  });
  // Role actions
  document.querySelectorAll('[data-ra]').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      const action=btn.dataset.ra,email=btn.dataset.email;
      if(!email)return;
      if(action==='revoke'&&!confirm(`Revoke access for ${email}?`))return;
      btn.disabled=true;
      try{
        if(action==='revoke'){
          await sb.from('reviewer_users').delete().eq('email',email);
          await sb.from('admin_users').delete().eq('email',email);
        }else if(action==='admin'){
          await sb.from('admin_users').upsert({email},{onConflict:'email'});
          await sb.from('reviewer_users').delete().eq('email',email);
        }else{
          await sb.from('reviewer_users').upsert({email},{onConflict:'email'});
          await sb.from('admin_users').delete().eq('email',email);
        }
        await boot();
      }catch(e){alert(e.message||'Error');btn.disabled=false;}
    });
  });
}

/* ══ BOOT ════════════════════════════════════════════════════════════ */
async function boot(){
  document.body.classList.add('cxon');
  document.body.innerHTML='<div class="cx-loader"><div class="cx-spinner"></div></div>';
  try{
    const ok=await initAuth();
    if(!ok)return;
    /* renderRoute() returns the WHOLE page, sidebar included. If it ever
       resolves to nothing the body is wiped and you get a black screen with
       no clue why — the catch below only fires on a throw, not on an empty
       return. Fail loudly instead. */
    const html=await renderRoute();
    if(typeof html!=='string' || html.trim()===''){
      throw new Error('The '+PATH+' page returned no content. '+
        'This is a bug in that page, not your account.');
    }
    document.body.innerHTML=html;
    document.title='Clipency | Admin OS';
    bindEvents();
  }catch(e){
    document.body.innerHTML=`<div id="cxos" style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#000"><div style="text-align:center;max-width:440px">
      <h2 style="color:#f5f5f7;font-size:22px;margin-bottom:10px">Something went wrong.</h2>
      <p style="color:rgba(255,255,255,.45);font-size:13.5px;line-height:1.6;margin-bottom:20px">${esc(e.message||'Please refresh.')}</p>
      <pre style="text-align:left;color:rgba(255,255,255,.3);font-size:10.5px;line-height:1.5;max-height:180px;overflow:auto;background:rgba(255,255,255,.04);padding:10px;border-radius:8px;margin-bottom:18px;white-space:pre-wrap">${esc((e&&e.stack||'').split('\n').slice(0,6).join('\n'))}</pre>
      <a class="cx-btn pri" href="/admin">Retry</a>
    </div></div>`;
  }
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);
else boot();
})();

/* Review button delegated handler */
document.addEventListener('click', function(e){
  const btn = e.target.closest('.cx-review-btn');
  if(!btn) return;
  const d = btn.dataset;
  openReviewModal(d.id, d.name, d.camp, d.platform, d.handle, d.clip,
    Number(d.views||0), Number(d.amt||0), d.status,
    Number(d.likes||0), Number(d.comments||0), d.appeal, d.rejreason,
    d.editedat||'', d.editedby||'');
});
