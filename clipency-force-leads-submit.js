
/* =====================================================
   CLIPENCY FORCE LANDING LEAD SUBMIT
   Guarantees landing page inquiry goes to Supabase leads.
   Works even if existing landing page uses custom JS instead of form submit.
   ===================================================== */
(function(){
  let isSubmittingLead = false;

  function lower(v){
    return String(v || "").toLowerCase().trim();
  }

  function getClient(){
    return window.clipencySupabase || window.supabaseClient || window.sbClient || window.supabase || null;
  }

  function loadScript(src){
    return new Promise((resolve, reject) => {
      if(document.querySelector(`script[src="${src}"]`)) return resolve();

      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function waitClient(){
    for(let i = 0; i < 30; i++){
      const client = getClient();
      if(client && client.from) return client;
      await new Promise(r => setTimeout(r, 150));
    }

    try{
      await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2");
      await loadScript("/supabaseClient.js?v=force-leads-submit-1");
    }catch(e){}

    for(let i = 0; i < 40; i++){
      const client = getClient();
      if(client && client.from) return client;
      await new Promise(r => setTimeout(r, 150));
    }

    return null;
  }

  function fieldName(el){
    const label = el.id
      ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent
      : "";

    return lower(
      el.name ||
      el.id ||
      el.getAttribute("aria-label") ||
      el.placeholder ||
      label ||
      ""
    )
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  }

  function collectFromScope(scope){
    const raw = {};
    const fields = Array.from(scope.querySelectorAll("input, textarea, select"));

    fields.forEach(el => {
      if(el.disabled) return;
      if(["submit", "button", "reset", "hidden"].includes(lower(el.type))) return;

      const key = fieldName(el);
      if(!key) return;

      if(el.type === "checkbox"){
        raw[key] = el.checked;
      }else if(el.type === "radio"){
        if(el.checked) raw[key] = el.value;
      }else{
        raw[key] = el.value;
      }
    });

    return raw;
  }

  function pick(raw, patterns){
    const entries = Object.entries(raw);

    for(const pattern of patterns){
      const found = entries.find(([k,v]) => pattern.test(k) && String(v || "").trim());
      if(found) return String(found[1]).trim();
    }

    return "";
  }

  function getLikelyLeadScope(clickedElement){
    const form = clickedElement?.closest?.("form");
    if(form) return form;

    const sections = Array.from(document.querySelectorAll("section, main, div"));
    const withFields = sections
      .filter(el => el.querySelectorAll("input, textarea, select").length >= 2)
      .sort((a,b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return (ar.width * ar.height) - (br.width * br.height);
      });

    return withFields[0] || document;
  }

  function hasLeadFields(raw){
    const keys = Object.keys(raw).join(" ");
    const values = Object.values(raw).join(" ");
    const text = lower(keys + " " + values);

    return /email|mail/.test(text)
      && /name|brand|company|business|phone|budget|campaign|message|goal|requirement/.test(text);
  }

  function buildPayload(raw){
    return {
      full_name: pick(raw, [/full.*name/, /^name$/, /your.*name/, /first.*name/, /client.*name/]),
      email: pick(raw, [/email/, /mail/]),
      phone: pick(raw, [/phone/, /mobile/, /whatsapp/, /contact.*number/]),
      company: pick(raw, [/company/, /business/, /organisation/, /organization/]),
      brand_name: pick(raw, [/brand/, /startup/, /project/]),
      campaign_type: pick(raw, [/campaign.*type/, /type/, /service/, /goal/, /campaign/]),
      budget: pick(raw, [/budget/, /spend/, /amount/]),
      message: pick(raw, [/message/, /requirement/, /details/, /description/, /note/, /goal/]),
      source_page: location.pathname || "/",
      status: "new",
      raw_payload: raw
    };
  }

  function showLeadToast(message, isError){
    let box = document.getElementById("cx-force-lead-toast");

    if(!box){
      box = document.createElement("div");
      box.id = "cx-force-lead-toast";
      box.style.cssText = `
        position:fixed;
        right:22px;
        bottom:22px;
        z-index:2147483647;
        max-width:380px;
        padding:16px 18px;
        border-radius:18px;
        border:1px solid rgba(224,172,120,.38);
        background:linear-gradient(145deg,rgba(36,24,15,.96),rgba(10,7,5,.98));
        color:#fff8ef;
        box-shadow:0 20px 60px rgba(0,0,0,.35);
        font:700 14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;
        opacity:0;
        transform:translateY(10px);
        transition:.22s ease;
      `;
      document.body.appendChild(box);
    }

    box.textContent = message;
    box.style.borderColor = isError ? "rgba(239,68,68,.62)" : "rgba(224,172,120,.44)";
    box.style.opacity = "1";
    box.style.transform = "translateY(0)";

    clearTimeout(window.__cxForceLeadToastTimer);
    window.__cxForceLeadToastTimer = setTimeout(() => {
      box.style.opacity = "0";
      box.style.transform = "translateY(10px)";
    }, 4200);
  }

  async function insertLeadFromScope(scope){
    if(isSubmittingLead) return true;
    isSubmittingLead = true;

    try{
      const raw = collectFromScope(scope);

      if(!hasLeadFields(raw)){
        isSubmittingLead = false;
        return false;
      }

      const payload = buildPayload(raw);

      if(!payload.email){
        showLeadToast("Please enter an email before submitting.", true);
        isSubmittingLead = false;
        return true;
      }

      const client = await waitClient();

      if(!client){
        showLeadToast("Lead system could not connect. Please try again.", true);
        isSubmittingLead = false;
        return true;
      }

      const { error } = await client
        .from("leads")
        .insert(payload);

      if(error){
        console.error("Clipency lead insert failed:", error);
        showLeadToast("Lead could not be saved. Please try again.", true);
        isSubmittingLead = false;
        return true;
      }

      console.log("Clipency lead saved:", payload);
      showLeadToast("Submitted. Clipency team will contact you soon.", false);

      isSubmittingLead = false;
      return true;
    }catch(err){
      console.error("Clipency lead submit error:", err);
      showLeadToast("Lead could not be saved. Please try again.", true);
      isSubmittingLead = false;
      return true;
    }
  }

  function buttonLooksLikeLeadSubmit(btn){
    const text = lower(btn.textContent || btn.value || "");
    return /submit|send|start|scale|brand|campaign|get started|launch|book|inquiry|enquiry|contact/.test(text);
  }

  function bind(){
    document.addEventListener("submit", async function(e){
      const form = e.target;
      if(!form || !form.querySelectorAll) return;

      const raw = collectFromScope(form);
      if(!hasLeadFields(raw)) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      await insertLeadFromScope(form);
    }, true);

    document.addEventListener("click", async function(e){
      const btn = e.target.closest("button, input[type='submit'], a");
      if(!btn) return;
      if(!buttonLooksLikeLeadSubmit(btn)) return;

      const scope = getLikelyLeadScope(btn);
      const raw = collectFromScope(scope);

      if(!hasLeadFields(raw)) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      await insertLeadFromScope(scope);

      // Let existing success UI appear after DB insert, if it depends on click handlers.
      setTimeout(() => {
        try{
          const successCards = Array.from(document.querySelectorAll("*")).filter(el =>
            /pipeline|thank you|submitted|response within 24 hours/i.test(el.textContent || "")
          );
          successCards.forEach(el => {
            el.style.display = "";
            el.style.visibility = "";
            el.style.opacity = "";
          });
        }catch(_){}
      }, 150);
    }, true);
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", bind);
  }else{
    bind();
  }

  window.addEventListener("load", bind);
})();
