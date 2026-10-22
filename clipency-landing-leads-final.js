/* ═══ CLIPENCY — Landing Lead Capture ═══ */
(function(){
  const _orig = window.submitForm;

  async function waitForClient(){
    for(let i=0;i<50;i++){
      const sb = window.clipencySupabase || window.supabaseClient || window.sbClient;
      if(sb && sb.from) return sb;
      await new Promise(r=>setTimeout(r,100));
    }
    return null;
  }

  async function saveLead(type){
    const sb = await waitForClient();
    if(!sb){
      console.warn('[leads] no supabase client after waiting');
      return false;
    }
    const g = id => (document.getElementById(id)||{}).value || '';
    const email = g('cf-email');
    if(!email){
      console.warn('[leads] no email entered, blocking submit');
      return false;
    }
    const payload = {
      full_name:     g('cf-name'),
      email:         email,
      phone:         (g('cf-country')||'+91') + ' ' + g('cf-phone'),
      company:       g('cf-brand'),
      brand_name:    g('cf-brand'),
      campaign_type: g('cf-type') || 'Brand Campaign',
      budget:        g('cf-budget'),
      message:       g('cf-goal'),
      source_page:   window.location.href,
      status:        'new',
    };
    console.log('[leads] saving:', payload);
    const { error } = await sb.from('leads').insert([payload]);
    if(error){ console.warn('[leads] error:', error.message, error); return false; }
    console.log('[leads] ✅ saved');
    return true;
  }

  window.submitForm = async function(type){
    const ok = await saveLead(type);
    if(!ok){
      alert('Something went wrong submitting your inquiry. Please check your details and try again, or email us directly.');
      return;
    }
    if(typeof _orig === 'function') _orig(type);
    else {
      const p = document.getElementById('panel-' + type);
      const s = document.getElementById('form-success-msg');
      if(p) p.style.display = 'none';
      if(s) { s.style.display = 'flex'; }
    }
  };
})();
