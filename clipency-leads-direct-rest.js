
/* =====================================================
   CLIPENCY DIRECT LEADS REST ENGINE
   Landing page -> Supabase public.leads
   Bypasses broken/custom form JS and posts directly through REST.
   ===================================================== */
(function(){
  const STATE = {
    config: null,
    submitting: false,
    lastSentKey: "",
    lastSentAt: 0
  };

  function lower(v){
    return String(v || "").toLowerCase().trim();
  }

  function visible(el){
    if(!el) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function cleanKey(v){
    return lower(v)
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function getLabelText(el){
    if(el.id){
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if(label) return label.textContent || "";
    }

    const parentLabel = el.closest("label");
    if(parentLabel) return parentLabel.textContent || "";

    return "";
  }

  function fieldName(el){
    return cleanKey(
      el.name ||
      el.id ||
      el.getAttribute("aria-label") ||
      el.placeholder ||
      getLabelText(el) ||
      ""
    );
  }

  function collect(scope){
    const raw = {};
    const fields = Array.from((scope || document).querySelectorAll("input, textarea, select"));

    fields.forEach((el, index) => {
      if(el.disabled) return;
      if(["button", "submit", "reset", "hidden", "password"].includes(lower(el.type))) return;
      if(!visible(el)) return;

      let key = fieldName(el) || `field_${index + 1}`;
      let value = "";

      if(el.type === "checkbox"){
        value = el.checked ? "yes" : "";
      } else if(el.type === "radio"){
        if(!el.checked) return;
        value = el.value;
      } else {
        value = el.value;
      }

      if(String(value || "").trim()){
        raw[key] = String(value).trim();
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

    for(const pattern of patterns){
      const found = entries.find(([k,v]) => pattern.test(String(v || "")) && String(v || "").trim());
      if(found) return String(found[1]).trim();
    }

    return "";
  }

  function findEmail(raw){
    const byKey = pick(raw, [/email/, /mail/]);
    if(byKey && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(byKey)) return byKey;

    const byValue = Object.values(raw).find(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim()));
    return byValue ? String(byValue).trim() : "";
  }

  function looksLikeLead(raw){
    const text = lower(Object.keys(raw).join(" ") + " " + Object.values(raw).join(" "));
    return /^[\s\S]*[^\s@]+@[^\s@]+\.[^\s@]+[\s\S]*$/.test(text)
      && /name|brand|company|business|phone|mobile|budget|campaign|goal|message|requirement|contact|whatsapp/.test(text);
  }

  function buildPayload(raw){
    return {
      full_name: pick(raw, [/full.*name/, /^name$/, /your.*name/, /client.*name/, /first.*name/]),
      email: findEmail(raw),
      phone: pick(raw, [/phone/, /mobile/, /whatsapp/, /contact.*number/]),
      company: pick(raw, [/company/, /business/, /organisation/, /organization/]),
      brand_name: pick(raw, [/brand/, /startup/, /project/]),
      campaign_type: pick(raw, [/campaign.*type/, /campaign/, /type/, /service/, /goal/]),
      budget: pick(raw, [/budget/, /spend/, /amount/, /price/]),
      message: pick(raw, [/message/, /requirement/, /details/, /description/, /note/, /brief/, /goal/]),
      source_page: location.pathname || "/",
      status: "new",
      raw_payload: raw
    };
  }

  async function getSupabaseConfig(){
    if(STATE.config) return STATE.config;

    const tryGlobals = () => {
      const client = window.clipencySupabase || window.supabaseClient || window.sbClient;
      if(client && client.supabaseUrl && client.supabaseKey){
        return {
          url: client.supabaseUrl,
          key: client.supabaseKey
        };
      }
      return null;
    };

    const globalConfig = tryGlobals();
    if(globalConfig){
      STATE.config = globalConfig;
      return STATE.config;
    }

    const paths = [
      "/supabaseClient.js",
      "/Clipency Authentication/supabaseClient.js"
    ];

    for(const path of paths){
      try{
        const txt = await fetch(path, { cache: "no-store" }).then(r => r.ok ? r.text() : "");

        const urlMatch = txt.match(/https:\/\/[a-z0-9.-]+\.supabase\.co/i);
        const keyMatch = txt.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);

        if(urlMatch && keyMatch){
          STATE.config = {
            url: urlMatch[0],
            key: keyMatch[0]
          };
          return STATE.config;
        }
      }catch(e){}
    }

    return null;
  }

  function toast(message, error){
    let box = document.getElementById("cx-direct-lead-toast");

    if(!box){
      box = document.createElement("div");
      box.id = "cx-direct-lead-toast";
      box.style.cssText = `
        position:fixed;
        right:22px;
        bottom:22px;
        z-index:2147483647;
        max-width:390px;
        padding:16px 18px;
        border-radius:18px;
        border:1px solid rgba(224,172,120,.42);
        background:linear-gradient(145deg,rgba(36,24,15,.96),rgba(10,7,5,.98));
        color:#fff8ef;
        box-shadow:0 20px 60px rgba(0,0,0,.38);
        font:700 14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;
        opacity:0;
        transform:translateY(10px);
        transition:.22s ease;
      `;
      document.body.appendChild(box);
    }

    box.textContent = message;
    box.style.borderColor = error ? "rgba(239,68,68,.62)" : "rgba(224,172,120,.48)";
    box.style.opacity = "1";
    box.style.transform = "translateY(0)";

    clearTimeout(window.__cxLeadDirectToast);
    window.__cxLeadDirectToast = setTimeout(() => {
      box.style.opacity = "0";
      box.style.transform = "translateY(10px)";
    }, 4200);
  }

  function saveLastRaw(raw){
    if(looksLikeLead(raw)){
      sessionStorage.setItem("cx_last_lead_raw", JSON.stringify(raw));
    }
  }

  function getLastRaw(){
    try{
      return JSON.parse(sessionStorage.getItem("cx_last_lead_raw") || "{}");
    }catch(e){
      return {};
    }
  }

  async function insertLead(raw, reason){
    if(!looksLikeLead(raw)){
      raw = getLastRaw();
    }

    if(!looksLikeLead(raw)){
      console.warn("[Clipency Leads] No lead-like fields found.", reason, raw);
      return false;
    }

    const payload = buildPayload(raw);

    if(!payload.email){
      console.warn("[Clipency Leads] Email missing.", payload);
      toast("Please enter your email before submitting.", true);
      return true;
    }

    const key = JSON.stringify({
      email: payload.email,
      phone: payload.phone,
      brand: payload.brand_name,
      message: payload.message
    });

    const now = Date.now();
    if(STATE.lastSentKey === key && now - STATE.lastSentAt < 12000){
      console.log("[Clipency Leads] Duplicate blocked.");
      return true;
    }

    STATE.lastSentKey = key;
    STATE.lastSentAt = now;

    const config = await getSupabaseConfig();

    if(!config){
      console.error("[Clipency Leads] Supabase config missing.");
      toast("Lead system could not connect. Please try again.", true);
      return true;
    }

    try{
      const res = await fetch(`${config.url}/rest/v1/leads`, {
        method: "POST",
        keepalive: true,
        headers: {
          "apikey": config.key,
          "Authorization": `Bearer ${config.key}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify(payload)
      });

      const text = await res.text();

      if(!res.ok){
        console.error("[Clipency Leads] REST insert failed:", res.status, text);
        toast("Lead could not be saved. Please try again.", true);
        return true;
      }

      console.log("[Clipency Leads] Saved successfully:", payload, text);
      toast("Submitted. Clipency team will contact you soon.", false);
      sessionStorage.removeItem("cx_last_lead_raw");
      return true;
    }catch(error){
      console.error("[Clipency Leads] REST error:", error);
      toast("Lead could not be saved. Please try again.", true);
      return true;
    }
  }

  function bestScopeFrom(el){
    return el?.closest?.("form")
      || el?.closest?.("section")
      || el?.closest?.("main")
      || document;
  }

  function buttonLooksRelevant(el){
    const text = lower(el?.textContent || el?.value || el?.getAttribute?.("aria-label") || "");
    return /submit|send|start|scale|brand|campaign|get started|launch|contact|inquiry|enquiry|book|move next|pipeline/.test(text);
  }

  function bind(){
    document.addEventListener("input", function(){
      const raw = collect(document);
      saveLastRaw(raw);
    }, true);

    document.addEventListener("change", function(){
      const raw = collect(document);
      saveLastRaw(raw);
    }, true);

    document.addEventListener("click", function(e){
      const target = e.target.closest("button,input[type='submit'],a,[role='button']");
      if(!target) return;

      const scope = bestScopeFrom(target);
      const raw = collect(scope);
      saveLastRaw(raw);

      if(buttonLooksRelevant(target) || looksLikeLead(raw)){
        insertLead(raw, "click");
      }
    }, true);

    document.addEventListener("submit", function(e){
      const form = e.target;
      if(!form || !form.querySelectorAll) return;

      const raw = collect(form);
      saveLastRaw(raw);

      if(looksLikeLead(raw)){
        insertLead(raw, "submit");
      }
    }, true);

    const observer = new MutationObserver(function(){
      const text = lower(document.body.textContent || "");
      if(/you.re in the pipeline|you're in the pipeline|submitted|thank you/.test(text)){
        const raw = getLastRaw();
        if(looksLikeLead(raw)){
          insertLead(raw, "success-screen");
        }
      }
    });

    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true
    });

    window.cxTestLeadInsert = function(){
      return insertLead({
        full_name: "Browser Test Lead",
        email: "browser-test@clipency.in",
        phone: "9999999999",
        company: "Browser Test Company",
        brand_name: "Browser Test Brand",
        campaign_type: "Brand Campaign",
        budget: "$500",
        message: "Browser test lead from landing page console."
      }, "manual-test");
    };

    console.log("[Clipency Leads] Direct REST lead engine loaded.");
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", bind);
  }else{
    bind();
  }

  window.addEventListener("load", bind);
})();
