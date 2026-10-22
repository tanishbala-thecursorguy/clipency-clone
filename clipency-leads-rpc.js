
/* =====================================================
   CLIPENCY LANDING LEADS RPC ENGINE
   Sends landing page inquiries to public.submit_landing_lead(payload)
   ===================================================== */
(function(){
  let lastRaw = {};
  let sending = false;
  let lastSent = "";

  function lower(v){
    return String(v || "").toLowerCase().trim();
  }

  function cleanKey(v){
    return lower(v)
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function getConfigFromGlobals(){
    const c = window.clipencySupabase || window.supabaseClient || window.sbClient;

    if(c && c.supabaseUrl && c.supabaseKey){
      return {
        url: c.supabaseUrl,
        key: c.supabaseKey
      };
    }

    return null;
  }

  async function getConfig(){
    const globalConfig = getConfigFromGlobals();
    if(globalConfig) return globalConfig;

    const files = ["/supabaseClient.js", "/Clipency Authentication/supabaseClient.js"];

    for(const file of files){
      try{
        const txt = await fetch(file, { cache: "no-store" }).then(r => r.ok ? r.text() : "");
        const url = txt.match(/https:\/\/[a-z0-9.-]+\.supabase\.co/i)?.[0];
        const key = txt.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0];

        if(url && key){
          return { url, key };
        }
      }catch(e){}
    }

    return null;
  }

  function labelText(el){
    if(el.id){
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if(label) return label.textContent || "";
    }

    const parent = el.closest("label");
    return parent ? parent.textContent || "" : "";
  }

  function fieldName(el, index){
    return cleanKey(
      el.name ||
      el.id ||
      el.getAttribute("aria-label") ||
      el.placeholder ||
      labelText(el) ||
      `field_${index + 1}`
    );
  }

  function collect(scope){
    const raw = {};
    const fields = Array.from((scope || document).querySelectorAll("input, textarea, select"));

    fields.forEach((el, index) => {
      if(el.disabled) return;
      if(["button", "submit", "reset", "hidden", "password"].includes(lower(el.type))) return;

      const key = fieldName(el, index);
      let value = "";

      if(el.type === "checkbox"){
        value = el.checked ? "yes" : "";
      }else if(el.type === "radio"){
        if(!el.checked) return;
        value = el.value;
      }else{
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

    return "";
  }

  function findEmail(raw){
    const byKey = pick(raw, [/email/, /mail/]);
    if(byKey && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(byKey)) return byKey;

    const byValue = Object.values(raw).find(v =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim())
    );

    return byValue ? String(byValue).trim() : "";
  }

  function payloadFromRaw(raw){
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
      raw_payload: raw
    };
  }

  function looksLikeLead(raw){
    const email = findEmail(raw);
    const text = lower(Object.keys(raw).join(" ") + " " + Object.values(raw).join(" "));
    return !!email && /name|brand|company|business|phone|mobile|budget|campaign|goal|message|requirement|contact|whatsapp/.test(text);
  }

  function toast(message, isError){
    let box = document.getElementById("cx-leads-rpc-toast");

    if(!box){
      box = document.createElement("div");
      box.id = "cx-leads-rpc-toast";
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
    box.style.borderColor = isError ? "rgba(239,68,68,.62)" : "rgba(224,172,120,.48)";
    box.style.opacity = "1";
    box.style.transform = "translateY(0)";

    clearTimeout(window.__cxLeadRpcToast);
    window.__cxLeadRpcToast = setTimeout(() => {
      box.style.opacity = "0";
      box.style.transform = "translateY(10px)";
    }, 4200);
  }

  async function sendLead(raw, reason){
    if(!looksLikeLead(raw)) raw = lastRaw;
    if(!looksLikeLead(raw)) return false;

    const payload = payloadFromRaw(raw);

    if(!payload.email){
      toast("Please enter your email before submitting.", true);
      return true;
    }

    const dedupe = JSON.stringify({
      email: payload.email,
      phone: payload.phone,
      brand: payload.brand_name,
      budget: payload.budget,
      message: payload.message
    });

    if(lastSent === dedupe) return true;
    if(sending) return true;

    sending = true;
    lastSent = dedupe;

    try{
      const config = await getConfig();

      if(!config){
        console.error("[Clipency Leads RPC] Supabase config not found.");
        toast("Lead system could not connect.", true);
        sending = false;
        return true;
      }

      const res = await fetch(`${config.url}/rest/v1/rpc/submit_landing_lead`, {
        method: "POST",
        keepalive: true,
        headers: {
          "apikey": config.key,
          "Authorization": `Bearer ${config.key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ payload })
      });

      const text = await res.text();

      if(!res.ok){
        console.error("[Clipency Leads RPC] Failed:", res.status, text);
        toast("Lead could not be saved. Check console.", true);
        sending = false;
        return true;
      }

      console.log("[Clipency Leads RPC] Saved:", payload, text);
      toast("Submitted. Clipency team will contact you soon.", false);
      sending = false;
      return true;
    }catch(error){
      console.error("[Clipency Leads RPC] Error:", error);
      toast("Lead could not be saved. Check console.", true);
      sending = false;
      return true;
    }
  }

  function bestScope(el){
    return el?.closest?.("form")
      || el?.closest?.("section")
      || el?.closest?.("main")
      || document;
  }

  function relevantButton(el){
    const text = lower(el?.textContent || el?.value || el?.getAttribute?.("aria-label") || "");
    return /submit|send|start|scale|brand|campaign|get started|launch|contact|inquiry|enquiry|book|move next|pipeline/.test(text);
  }

  function captureCurrent(scope){
    const raw = collect(scope || document);
    if(Object.keys(raw).length) lastRaw = raw;
    return raw;
  }

  function bind(){
    document.addEventListener("input", function(e){
      captureCurrent(bestScope(e.target));
    }, true);

    document.addEventListener("change", function(e){
      captureCurrent(bestScope(e.target));
    }, true);

    document.addEventListener("submit", async function(e){
      const raw = captureCurrent(e.target);
      if(!looksLikeLead(raw)) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      await sendLead(raw, "submit");
    }, true);

    document.addEventListener("click", async function(e){
      const target = e.target.closest("button,input[type='submit'],a,[role='button']");
      if(!target) return;

      const raw = captureCurrent(bestScope(target));

      if(!relevantButton(target) && !looksLikeLead(raw)) return;

      if(looksLikeLead(raw)){
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        await sendLead(raw, "click");
      }
    }, true);

    const observer = new MutationObserver(function(){
      const text = lower(document.body.textContent || "");
      if(/you.re in the pipeline|you're in the pipeline|submitted|thank you/.test(text)){
        sendLead(lastRaw, "success-screen");
      }
    });

    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true
    });

    window.cxLeadSmokeTest = function(){
      return sendLead({
        name: "Smoke Test Lead",
        email: "smoke-test@clipency.in",
        phone: "9999999999",
        brand: "Smoke Test Brand",
        budget: "$500",
        message: "Smoke test from live browser console"
      }, "manual-smoke-test");
    };

    console.log("[Clipency Leads RPC] Engine loaded. Test with cxLeadSmokeTest()");
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", bind);
  }else{
    bind();
  }

  window.addEventListener("load", bind);
})();
