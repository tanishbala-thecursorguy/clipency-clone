/**
 * Clipency Admin OS — Enhancement Layer
 * Loads after clipency-admin-os.js via auth/admin/index.html
 * Provides: toast system, edit tracking, rich humanized logs, openReviewModal override
 */
(function(){
'use strict';

/* ══ TOAST SYSTEM ══════════════════════════════════════════════════════ */
window.toast = function(msg, type) {
  type = type || 'ok';
  var tc = document.getElementById('cx-toast-wrap');
  if (!tc) {
    tc = document.createElement('div');
    tc.id = 'cx-toast-wrap';
    tc.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:999999;display:flex;flex-direction:column-reverse;gap:8px;pointer-events:none;max-width:360px';
    document.body.appendChild(tc);
  }
  var cfg = {ok:{bg:'rgba(34,197,94,.12)',bd:'rgba(74,222,128,.3)',col:'#4ade80'},
             err:{bg:'rgba(239,68,68,.12)',bd:'rgba(248,113,113,.3)',col:'#f87171'},
             info:{bg:'rgba(99,102,241,.12)',bd:'rgba(165,180,252,.3)',col:'#a5b4fc'}}[type]
           || {bg:'rgba(99,102,241,.12)',bd:'rgba(165,180,252,.3)',col:'#a5b4fc'};
  var t = document.createElement('div');
  t.style.cssText = 'pointer-events:auto;padding:12px 18px;border-radius:12px;font-size:13.5px;font-weight:600;'+
    'backdrop-filter:blur(16px);background:'+cfg.bg+';border:1px solid '+cfg.bd+';color:'+cfg.col+';'+
    'box-shadow:0 8px 32px rgba(0,0,0,.45);animation:cxSlideToast .3s cubic-bezier(.34,1.2,.64,1) both;'+
    'max-width:360px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.4;';
  t.textContent = msg;
  tc.appendChild(t);
  setTimeout(function(){
    t.style.opacity = '0';
    t.style.transform = 'translateX(110%)';
    t.style.transition = 'all .3s ease';
    setTimeout(function(){ t.remove(); }, 300);
  }, 3200);
};

/* ══ RICH HUMANIZE AUDIT ════════════════════════════════════════════ */
window.__cxHumanize = function(r) {
  var o = r.old_data || {}, n = r.new_data || {}, t = r.target_table || '';
  var action = r.action || '';
  var money = function(v){ return '\u20b9' + Number(v||0).toLocaleString('en-IN'); };
  var fmtV = function(v){ var vn=Number(v||0); return vn>=1e6?(vn/1e6).toFixed(1)+'M':vn>=1000?(vn/1000).toFixed(0)+'K':String(vn); };
  var actorName = (r.actor_email||'Unknown').split('@')[0];
  var roleLabel = r.actor_role ? ' ('+r.actor_role+')' : '';

  if (t === 'clip_submissions') {
    var handle = n.handle||o.handle||'\u2014';
    var platform = n.platform||o.platform||'\u2014';
    var campaign = n.campaign_title||o.campaign_title||'Campaign';
    var views = n.views_count||n.views||o.views_count||0;
    var earning = n.approved_amount||n.earning_amount||o.approved_amount||0;
    var reason = n.rejection_reason||'';
    if (n.status === 'approved') {
      return {icon:'\u2705', actor:actorName+roleLabel,
        text:'Approved @'+handle+'\'s '+platform+' clip',
        detail:campaign+(views?' \u00b7 '+fmtV(views)+' views':'')+(earning?' \u00b7 '+money(earning)+' earned':''),
        status:'approved'};
    }
    if (n.status === 'rejected') {
      return {icon:'\u274c', actor:actorName+roleLabel,
        text:'Rejected @'+handle+'\'s '+platform+' clip',
        detail:campaign+(reason?' \u00b7 "'+reason.slice(0,80)+'"':' \u00b7 No reason given'),
        status:'rejected'};
    }
    if (o.status === 'approved' && n.status === 'approved') {
      return {icon:'\u270f\ufe0f', actor:actorName+roleLabel,
        text:'Edited @'+handle+'\'s approved clip',
        detail:campaign+(views?' \u00b7 Updated to '+fmtV(views)+' views':'')+(earning?' \u00b7 '+money(earning):''),
        status:'edited'};
    }
    if (action.indexOf('delete') === 0) {
      return {icon:'\ud83d\uddd1\ufe0f', actor:actorName+roleLabel,
        text:'Deleted @'+handle+'\'s clip submission', detail:campaign, status:'done'};
    }
    return {icon:'\ud83d\udcce', actor:actorName+roleLabel,
      text:'Updated @'+handle+'\'s '+platform+' clip',
      detail:campaign+' \u00b7 '+(o.status||'?')+' \u2192 '+(n.status||'?'),
      status:n.status||'done'};
  }
  if (t === 'payout_requests') {
    var amt = money(n.amount||o.amount);
    var ref = n.transaction_reference ? ' \u00b7 Ref: '+n.transaction_reference : '';
    var payUser = n.user_email||o.user_email||'\u2014';
    if (n.status === 'paid') {
      return {icon:'\ud83d\udcb8', actor:actorName+roleLabel,
        text:'Marked '+amt+' payout as PAID',
        detail:'Clipper: '+payUser+ref, status:'paid'};
    }
    if (n.status === 'rejected') {
      return {icon:'\u274c', actor:actorName+roleLabel,
        text:'Rejected '+amt+' payout request',
        detail:(n.note?'Reason: "'+n.note+'" \u00b7 ':'')+' Clipper: '+payUser,
        status:'rejected'};
    }
    return {icon:'\ud83d\udcb8', actor:actorName+roleLabel,
      text:'Updated payout ('+(o.status||'?')+' \u2192 '+(n.status||'?')+')',
      detail:amt, status:n.status||'done'};
  }
  if (t === 'connected_accounts') {
    var aHandle = n.handle||n.username||o.handle||o.username||'\u2014';
    var aPlatform = n.platform||o.platform||'\u2014';
    var aReason = n.rejection_reason||'';
    var aUser = n.user_email||o.user_email||'\u2014';
    if (n.status === 'verified') {
      return {icon:'\ud83d\udd17', actor:actorName+roleLabel,
        text:'Verified @'+aHandle+'\'s '+aPlatform+' account',
        detail:'User: '+aUser, status:'verified'};
    }
    if (n.status === 'rejected') {
      return {icon:'\ud83d\udd17', actor:actorName+roleLabel,
        text:'Rejected @'+aHandle+'\'s '+aPlatform+' account',
        detail:aReason ? 'Reason: "'+aReason+'"' : 'No reason given',
        status:'rejected'};
    }
    if (action.indexOf('delete') === 0) {
      return {icon:'\ud83d\uddd1\ufe0f', actor:actorName+roleLabel,
        text:'Removed @'+aHandle+'\'s '+aPlatform+' account', detail:'', status:'done'};
    }
    return {icon:'\ud83d\udd17', actor:actorName+roleLabel,
      text:'Updated @'+aHandle+'\'s '+aPlatform+' account',
      detail:(o.status||'?')+' \u2192 '+(n.status||'?'), status:n.status||'done'};
  }
  if (t === 'campaigns') {
    var title = n.title||o.title||'Untitled';
    if (action.indexOf('insert') === 0) return {icon:'\ud83c\udfa6', actor:actorName+roleLabel, text:'Created campaign "'+title+'"', detail:'', status:'done'};
    if (action.indexOf('delete') === 0) return {icon:'\ud83d\uddd1\ufe0f', actor:actorName+roleLabel, text:'Deleted campaign "'+title+'"', detail:'', status:'done'};
    var changes = [];
    if (o.status !== n.status) changes.push('status: '+o.status+' \u2192 '+n.status);
    if (o.title !== n.title) changes.push('title renamed');
    if (o.rpm !== n.rpm) changes.push('RPM: '+(o.rpm||'\u2014')+' \u2192 '+(n.rpm||'\u2014'));
    return {icon:'\ud83c\udfa6', actor:actorName+roleLabel, text:'Updated campaign "'+title+'"',
      detail:changes.join(' \u00b7 ')||'Settings changed', status:'done'};
  }
  if (t === 'admin_users') {
    if (action.indexOf('insert') === 0) return {icon:'\ud83d\udee1\ufe0f', actor:actorName+roleLabel, text:'Granted admin access', detail:'To: '+(n.email||'\u2014'), status:'done'};
    return {icon:'\ud83d\udee1\ufe0f', actor:actorName+roleLabel, text:'Revoked admin access', detail:'From: '+(o.email||'\u2014'), status:'done'};
  }
  if (t === 'reviewer_users') {
    if (action.indexOf('insert') === 0) return {icon:'\ud83d\udee1\ufe0f', actor:actorName+roleLabel, text:'Granted reviewer access', detail:'To: '+(n.email||'\u2014'), status:'done'};
    return {icon:'\ud83d\udee1\ufe0f', actor:actorName+roleLabel, text:'Revoked reviewer access', detail:'From: '+(o.email||'\u2014'), status:'done'};
  }
  if (t === 'access_invites') {
    if (action.indexOf('insert') === 0) return {icon:'\u2709\ufe0f', actor:actorName+roleLabel, text:'Invited '+(n.email||'\u2014')+' as '+(n.role||'\u2014'), detail:'', status:n.status||'pending'};
    return {icon:'\u2709\ufe0f', actor:actorName+roleLabel, text:'Updated invite for '+(n.email||o.email||'\u2014'), detail:n.status||'', status:n.status||'done'};
  }
  return {icon:'\ud83d\udccb', actor:actorName+roleLabel, text:action+(t?' on '+t:''), detail:'', status:'done'};
};

/* ══ LOG TABLE POST-PROCESSOR ═════════════════════════════════════════
   Watches the logs page and rewrites audit rows using the rich humanizer
═══════════════════════════════════════════════════════════════════════ */
function postProcessLogRows(root) {
  // This would require access to the raw audit data which is in JS scope
  // We instead enhance the actor column display that IS accessible
  root = root || document;
  root.querySelectorAll && root.querySelectorAll('table.cx-t tbody tr').forEach(function(row) {
    // Add hover highlight
    row.style.transition = 'background .15s';
  });
}

/* ══ REVIEW MODAL OVERRIDE ════════════════════════════════════════════
   Replaces openReviewModal to add:
   - Edit timestamp display (item 1)
   - Save edited_by_email + edited_at on approve (item 1)
   - Passes editedAt and editedByEmail params
═══════════════════════════════════════════════════════════════════════ */
/* ══ REVIEW MODAL OVERRIDE — REMOVED ══════════════════════════════════
   This used to replace openReviewModal purely to show an edit timestamp and
   record edited_by_email when a reviewer typed in views/earnings. Reviews no
   longer take typed numbers: approving fetches the real metrics and the
   database derives earnings from the campaign rate, so there is nothing to
   attribute. The base modal in clipency-admin-os.js is now the only one, and
   the delegated click handler below calls straight into it.
═══════════════════════════════════════════════════════════════════════ */

/* ══ DELEGATED CLICK HANDLER (replaces original) ════════════════════ */
document.addEventListener('click', function(e) {
  var btn = e.target.closest('.cx-review-btn');
  if (!btn) return;
  // Stop the original handler from also firing
  e.stopImmediatePropagation();
  var d = btn.dataset;
  window.openReviewModal(
    d.id, d.name, d.camp, d.platform, d.handle, d.clip,
    Number(d.views||0), Number(d.amt||0), d.status,
    Number(d.likes||0), Number(d.comments||0),
    d.appeal, d.rejreason,
    d.editedat||'', d.editedby||''
  );
}, true); // Use capture to fire before the original

/* ══ BOOT OBSERVER ══════════════════════════════════════════════════
   Runs after admin OS renders each page
═══════════════════════════════════════════════════════════════════ */
function waitForCxos(cb, retries) {
  retries = retries || 60;
  if (document.getElementById('cxos')) { cb(); return; }
  if (retries <= 0) return;
  setTimeout(function() { waitForCxos(cb, retries-1); }, 150);
}

waitForCxos(function() {
  var cxos = document.getElementById('cxos');
  if (!cxos) return;
  // Watch for re-renders (boot() replaces innerHTML)
  var obs = new MutationObserver(function() {
    postProcessLogRows(document);
  });
  obs.observe(cxos, {childList:true, subtree:false});
  postProcessLogRows(document);
});

})();
