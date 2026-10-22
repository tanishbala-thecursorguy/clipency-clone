
/* =====================================================
   CLIPENCY LEADS ENGINE
   Landing page form -> public.leads -> Admin OS Leads
   Data connection only. No Clipper/Admin redesign.
   ===================================================== */
(function(){
  function lower(v){
    return String(v || "").toLowerCase().trim();
  }

  function esc(v){
    return String(v ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
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
      await loadScript("/supabaseClient.js?v=leads-engine");
    }catch(e){}

    for(let i = 0; i < 30; i++){
      const client = getClient();
      if(client && client.from) return client;
      await new Promise(r => setTimeout(r, 150));
    }

    return null;
  }

  function fieldKey(el){
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

  function collectForm(form){
    const raw = {};

    Array.from(form.elements || []).forEach(el => {
      if(!el || el.disabled) return;
      if(["button", "submit", "reset", "fieldset"].includes(lower(el.type))) return;

      const key = fieldKey(el);
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

  function isLeadForm(form){
    if(!form || form.dataset.cxLeadBound === "true") return false;

    const text = lower(form.innerText || form.textContent || "");
    const html = lower(form.outerHTML || "");

    if(form.querySelector('input[type="password"]')) return false;
    if(/login|sign in|signin|signup|sign up|otp|password/.test(text)) return false;

    const raw = collectForm(form);
    const keys = Object.keys(raw).join(" ");

    const hasEmail = Array.from(form.querySelectorAll("input")).some(i =>
      lower(i.type) === "email" || /email/.test(fieldKey(i))
    );

    const leadSignal =
      /lead|brand|campaign|company|business|budget|phone|message|contact|scale/.test(keys) ||
      /lead|brand|campaign|company|business|budget|phone|message|contact|scale/.test(text) ||
      /lead|brand|campaign|company|business|budget|phone|message|contact|scale/.test(html);

    return hasEmail && leadSignal;
  }

  function toast(message, type){
    let box = document.getElementById("cx-lead-toast");

    if(!box){
      box = document.createElement("div");
      box.id = "cx-lead-toast";
      box.style.cssText = `
        position:fixed;
        right:22px;
        bottom:22px;
        z-index:2147483000;
        max-width:360px;
        padding:16px 18px;
        border-radius:18px;
        border:1px solid rgba(224,172,120,.34);
        background:linear-gradient(145deg,rgba(36,24,15,.96),rgba(10,7,5,.98));
        color:#fff8ef;
        box-shadow:0 20px 60px rgba(0,0,0,.35);
        font:600 14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;
        opacity:0;
        transform:translateY(10px);
        transition:.22s ease;
      `;
      document.body.appendChild(box);
    }

    box.textContent = message;
    box.style.borderColor = type === "error" ? "rgba(239,68,68,.5)" : "rgba(224,172,120,.42)";
    box.style.opacity = "1";
    box.style.transform = "translateY(0)";

    clearTimeout(window.__cxLeadToastTimer);
    window.__cxLeadToastTimer = setTimeout(() => {
      box.style.opacity = "0";
      box.style.transform = "translateY(10px)";
    }, 4200);
  }

  async function submitLead(form){
    const client = await waitClient();

    if(!client){
      toast("Lead system is loading. Please try again.", "error");
      return;
    }

    const raw = collectForm(form);

    const payload = {
      full_name: pick(raw, [/full.*name/, /^name$/, /your.*name/, /first.*name/]),
      email: pick(raw, [/email/, /mail/]),
      phone: pick(raw, [/phone/, /mobile/, /whatsapp/, /contact.*number/]),
      company: pick(raw, [/company/, /business/, /organisation/, /organization/]),
      brand_name: pick(raw, [/brand/, /startup/, /project/]),
      campaign_type: pick(raw, [/campaign.*type/, /type/, /service/, /goal/]),
      budget: pick(raw, [/budget/, /spend/, /amount/]),
      message: pick(raw, [/message/, /requirement/, /details/, /description/, /note/]),
      source_page: location.pathname || "/",
      status: "new",
      raw_payload: raw
    };

    if(!payload.email){
      toast("Please enter your email before submitting.", "error");
      return;
    }

    const { error } = await client
      .from("leads")
      .insert(payload);

    if(error){
      console.error("Lead insert failed:", error);
      toast("Lead could not be submitted. Please try again.", "error");
      return;
    }

    toast("Submitted. Clipency team will contact you soon.", "success");

    try{
      form.reset();
    }catch(e){}
  }

  function bindLandingForms(){
    const forms = Array.from(document.querySelectorAll("form"));

    forms.forEach(form => {
      if(!isLeadForm(form)) return;

      form.dataset.cxLeadBound = "true";

      form.addEventListener("submit", async function(e){
        e.preventDefault();
        e.stopPropagation();

        if(form.reportValidity && !form.reportValidity()) return;

        const submitter = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
        const oldText = submitter ? submitter.textContent : "";

        if(submitter){
          submitter.disabled = true;
          submitter.textContent = "Submitting...";
        }

        await submitLead(form);

        if(submitter){
          submitter.disabled = false;
          submitter.textContent = oldText || "Submit";
        }
      }, true);
    });
  }

  async function loadAdminLeads(){
    const host = document.getElementById("cx-admin-live-leads");
    const list = document.getElementById("cx-admin-live-leads-list");
    if(!host || !list) return;

    const client = await waitClient();

    if(!client){
      list.innerHTML = `<p style="color:#ef4444;">Supabase client not found.</p>`;
      return;
    }

    const { data, error } = await client
      .from("leads")
      .select("*")
      .order("created_at", { ascending:false })
      .limit(200);

    if(error){
      list.innerHTML = `<p style="color:#ef4444;">${esc(error.message)}</p>`;
      return;
    }

    const rows = data || [];

    if(!rows.length){
      list.innerHTML = `<p style="color:rgba(216,199,180,.72);">No landing leads yet.</p>`;
      return;
    }

    list.innerHTML = rows.map(r => {
      const when = r.created_at ? new Date(r.created_at).toLocaleString() : "";
      const raw = r.raw_payload || {};

      return `
        <article class="cx-lead-row" data-lead-id="${esc(r.id)}">
          <div>
            <strong>${esc(r.full_name || r.brand_name || r.company || "New lead")}</strong>
            <div class="cx-lead-muted">${esc(r.email || "")}${r.phone ? " • " + esc(r.phone) : ""}</div>
            <div class="cx-lead-muted">${esc(r.company || r.brand_name || "")}</div>
            <div class="cx-lead-muted">${esc(when)} • ${esc(r.source_page || "")}</div>
            ${
              r.message
                ? `<p>${esc(r.message)}</p>`
                : ""
            }
            ${
              Object.keys(raw).length
                ? `<details><summary>Raw form data</summary><pre>${esc(JSON.stringify(raw, null, 2))}</pre></details>`
                : ""
            }
          </div>
          <div class="cx-lead-side">
            <select data-status>
              ${["new","contacted","qualified","converted","rejected"].map(s =>
                `<option value="${s}" ${lower(r.status) === s ? "selected" : ""}>${s}</option>`
              ).join("")}
            </select>
            <span>${esc(r.budget || "")}</span>
          </div>
        </article>
      `;
    }).join("");
  }

  function injectAdminLeadPanel(){
    if(!location.pathname.replace(/\/+$/,"").endsWith("/admin/leads")) return;
    if(document.getElementById("cx-admin-live-leads")) return;

    const style = document.createElement("style");
    style.textContent = `
      #cx-admin-live-leads{
        margin:28px 0;
        padding:24px;
        border-radius:24px;
        border:1px solid rgba(196,149,106,.22);
        background:linear-gradient(145deg,rgba(36,24,15,.88),rgba(10,7,5,.92));
        color:#fff8ef;
      }
      #cx-admin-live-leads h2{margin:0 0 8px;color:#fff8ef;}
      #cx-admin-live-leads > p{margin:0 0 20px;color:rgba(216,199,180,.72);}
      .cx-lead-row{
        display:flex;
        justify-content:space-between;
        gap:18px;
        padding:18px 0;
        border-top:1px solid rgba(196,149,106,.12);
      }
      .cx-lead-row strong{font-size:17px;}
      .cx-lead-muted{color:rgba(216,199,180,.68);font-size:13px;margin-top:4px;}
      .cx-lead-row p{color:rgba(255,248,239,.86);margin:12px 0 0;}
      .cx-lead-side{
        min-width:190px;
        text-align:right;
        display:flex;
        flex-direction:column;
        gap:10px;
        align-items:flex-end;
      }
      .cx-lead-side select{
        border-radius:14px;
        border:1px solid rgba(224,172,120,.34);
        background:rgba(255,255,255,.045);
        color:#fff8ef;
        padding:10px 12px;
      }
      .cx-lead-row details{margin-top:10px;color:rgba(216,199,180,.72);}
      .cx-lead-row pre{
        max-width:720px;
        overflow:auto;
        background:rgba(0,0,0,.28);
        padding:12px;
        border-radius:12px;
      }
      @media(max-width:760px){
        .cx-lead-row{flex-direction:column;}
        .cx-lead-side{text-align:left;align-items:flex-start;}
      }
    `;
    document.head.appendChild(style);

    const panel = document.createElement("section");
    panel.id = "cx-admin-live-leads";
    panel.innerHTML = `
      <h2>Landing page leads</h2>
      <p>Every submitted landing page lead will appear here in real time.</p>
      <div id="cx-admin-live-leads-list">Loading leads...</div>
    `;

    const main = document.querySelector("main")
      || document.querySelector(".main")
      || document.querySelector(".content")
      || document.querySelector("[class*='content']")
      || document.body;

    const firstBigSection = main.querySelector("section, .card, .panel");
    if(firstBigSection && firstBigSection.parentElement === main){
      main.insertBefore(panel, firstBigSection);
    }else{
      main.appendChild(panel);
    }

    panel.addEventListener("change", async function(e){
      const select = e.target.closest("select[data-status]");
      if(!select) return;

      const row = select.closest("[data-lead-id]");
      if(!row) return;

      const client = await waitClient();
      if(!client) return;

      const { error } = await client
        .from("leads")
        .update({ status: select.value })
        .eq("id", row.dataset.leadId);

      if(error){
        alert(error.message);
      }
    });

    loadAdminLeads();
    setInterval(loadAdminLeads, 60000);
  }

  function boot(){
    bindLandingForms();
    injectAdminLeadPanel();

    setTimeout(bindLandingForms, 800);
    setTimeout(bindLandingForms, 2000);
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot);
  }else{
    boot();
  }

  window.addEventListener("load", boot);
})();
