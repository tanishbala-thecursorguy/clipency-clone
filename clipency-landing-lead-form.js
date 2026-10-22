
/* =====================================================
   CLIPENCY REAL LANDING LEAD FORM
   Replaces default pipeline card with actual lead form
   and submits directly to Supabase RPC.
   ===================================================== */
(function(){
  let mounted = false;

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

  async function getSupabaseConfig(){
    const c = window.clipencySupabase || window.supabaseClient || window.sbClient;

    if(c && c.supabaseUrl && c.supabaseKey){
      return {
        url: c.supabaseUrl,
        key: c.supabaseKey
      };
    }

    const files = [
      "/supabaseClient.js",
      "/Clipency Authentication/supabaseClient.js"
    ];

    for(const file of files){
      try{
        const txt = await fetch(file, { cache:"no-store" }).then(r => r.ok ? r.text() : "");
        const url = txt.match(/https:\/\/[a-z0-9.-]+\.supabase\.co/i)?.[0];
        const key = txt.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0];

        if(url && key){
          return { url, key };
        }
      }catch(e){}
    }

    return null;
  }

  function injectStyles(){
    if(document.getElementById("cx-real-lead-form-style")) return;

    const style = document.createElement("style");
    style.id = "cx-real-lead-form-style";
    style.textContent = `
      .cx-real-lead-card{
        width:100%;
        min-height:420px;
        border-radius:28px;
        border:1px solid rgba(196,149,106,.24);
        background:
          radial-gradient(circle at 50% 0%, rgba(196,149,106,.12), transparent 42%),
          linear-gradient(145deg, rgba(36,24,15,.88), rgba(10,7,5,.94));
        box-shadow:0 28px 90px rgba(0,0,0,.28);
        padding:clamp(24px,3vw,42px);
        box-sizing:border-box;
        color:#fff8ef;
      }

      .cx-real-lead-card h3{
        margin:0 0 10px;
        font-size:clamp(30px,3vw,48px);
        line-height:1;
        letter-spacing:-.04em;
        color:#fff8ef;
      }

      .cx-real-lead-card p{
        margin:0 0 24px;
        color:rgba(216,199,180,.78);
        line-height:1.5;
      }

      .cx-real-lead-grid{
        display:grid;
        grid-template-columns:1fr 1fr;
        gap:14px;
      }

      .cx-real-lead-field{
        display:flex;
        flex-direction:column;
        gap:7px;
      }

      .cx-real-lead-field.full{
        grid-column:1 / -1;
      }

      .cx-real-lead-field label{
        color:#e0ac78;
        font-size:11px;
        letter-spacing:.16em;
        text-transform:uppercase;
        font-weight:900;
      }

      .cx-real-lead-field input,
      .cx-real-lead-field select,
      .cx-real-lead-field textarea{
        width:100%;
        border-radius:16px;
        border:1px solid rgba(224,172,120,.32);
        background:rgba(255,255,255,.045);
        color:#fff8ef;
        padding:14px;
        font:600 15px system-ui,-apple-system,Segoe UI,sans-serif;
        outline:none;
        box-sizing:border-box;
      }

      .cx-real-lead-field textarea{
        min-height:96px;
        resize:vertical;
      }

      .cx-real-lead-field input::placeholder,
      .cx-real-lead-field textarea::placeholder{
        color:rgba(216,199,180,.46);
      }

      .cx-real-lead-actions{
        display:flex;
        align-items:center;
        gap:14px;
        margin-top:18px;
        flex-wrap:wrap;
      }

      .cx-real-lead-submit{
        min-height:54px;
        border:0;
        border-radius:16px;
        padding:0 24px;
        font-weight:900;
        color:#130d08;
        background:linear-gradient(135deg,#c4956a,#e0ac78);
        cursor:pointer;
        box-shadow:0 16px 34px rgba(196,149,106,.18);
      }

      .cx-real-lead-submit:disabled{
        opacity:.65;
        cursor:not-allowed;
      }

      .cx-real-lead-note{
        color:rgba(216,199,180,.68);
        font-size:13px;
      }

      .cx-real-lead-status{
        margin-top:14px;
        font-size:14px;
        font-weight:800;
      }

      .cx-real-lead-status.ok{color:#22c55e;}
      .cx-real-lead-status.err{color:#ef4444;}

      .cx-real-success{
        min-height:360px;
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        text-align:center;
        gap:16px;
      }

      .cx-real-success-icon{
        width:84px;
        height:84px;
        border-radius:999px;
        display:grid;
        place-items:center;
        border:1px solid rgba(224,172,120,.32);
        background:rgba(196,149,106,.12);
        font-size:34px;
      }

      @media(max-width:720px){
        .cx-real-lead-grid{
          grid-template-columns:1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function findPipelineCard(){
    const all = Array.from(document.querySelectorAll("section, div, article"));

    const pipelineText = all.find(el => {
      const text = lower(el.textContent);
      return text.includes("you're in the pipeline") || text.includes("you’re in the pipeline");
    });

    if(pipelineText){
      let node = pipelineText;

      for(let i = 0; i < 8 && node; i++){
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);

        if(
          rect.width > 320 &&
          rect.height > 220 &&
          (
            parseFloat(style.borderRadius) > 8 ||
            style.borderStyle !== "none" ||
            lower(node.className).includes("card")
          )
        ){
          return node;
        }

        node = node.parentElement;
      }

      return pipelineText;
    }

    const startSection = all.find(el => {
      const text = lower(el.textContent);
      return text.includes("tell us what you want to move next") || text.includes("start with clipency");
    });

    if(startSection){
      const cards = Array.from(startSection.querySelectorAll("div, article"))
        .filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 320 && rect.height > 220;
        })
        .sort((a,b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);

      if(cards[0]) return cards[0];
    }

    return null;
  }

  function renderForm(card){
    injectStyles();

    card.classList.add("cx-real-lead-card");
    card.innerHTML = `
      <h3>Start your campaign.</h3>
      <p>Share your campaign goal, budget and direction. A Clipency strategist will review it personally.</p>

      <form id="cx-real-lead-form">
        <div class="cx-real-lead-grid">
          <div class="cx-real-lead-field">
            <label for="cx-lead-name">Name</label>
            <input id="cx-lead-name" name="full_name" placeholder="Your name" required>
          </div>

          <div class="cx-real-lead-field">
            <label for="cx-lead-email">Email</label>
            <input id="cx-lead-email" name="email" type="email" placeholder="you@example.com" required>
          </div>

          <div class="cx-real-lead-field">
            <label for="cx-lead-phone">Phone</label>
            <input id="cx-lead-phone" name="phone" placeholder="+91 98765 43210">
          </div>

          <div class="cx-real-lead-field">
            <label for="cx-lead-brand">Brand / Company</label>
            <input id="cx-lead-brand" name="brand_name" placeholder="Brand name">
          </div>

          <div class="cx-real-lead-field">
            <label for="cx-lead-type">Campaign type</label>
            <select id="cx-lead-type" name="campaign_type">
              <option value="Brand Campaign">Brand Campaign</option>
              <option value="Music Promotion">Music Promotion</option>
              <option value="UGC / Clipping">UGC / Clipping</option>
              <option value="Performance Distribution">Performance Distribution</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div class="cx-real-lead-field">
            <label for="cx-lead-budget">Budget</label>
            <input id="cx-lead-budget" name="budget" placeholder="$500 / ₹50,000 / flexible">
          </div>

          <div class="cx-real-lead-field full">
            <label for="cx-lead-message">Campaign goal</label>
            <textarea id="cx-lead-message" name="message" placeholder="Tell us what you want to move next..." required></textarea>
          </div>
        </div>

        <div class="cx-real-lead-actions">
          <button class="cx-real-lead-submit" type="submit">Submit inquiry →</button>
          <span class="cx-real-lead-note">Response within 24 hours.</span>
        </div>

        <div id="cx-real-lead-status" class="cx-real-lead-status"></div>
      </form>
    `;

    bindForm(card);
  }

  function showSuccess(card){
    card.innerHTML = `
      <div class="cx-real-success">
        <div class="cx-real-success-icon">✦</div>
        <h3>You're in the pipeline.</h3>
        <p>We review every inquiry personally. Expect a response within 24 hours from a real Clipency strategist.</p>
      </div>
    `;
  }

  async function submitLead(payload){
    const config = await getSupabaseConfig();

    if(!config){
      throw new Error("Supabase config not found. Check supabaseClient.js.");
    }

    const res = await fetch(`${config.url}/rest/v1/rpc/submit_landing_lead`, {
      method:"POST",
      headers:{
        "apikey": config.key,
        "Authorization": `Bearer ${config.key}`,
        "Content-Type":"application/json"
      },
      body: JSON.stringify({ payload })
    });

    const text = await res.text();

    if(!res.ok){
      throw new Error(text || "Lead insert failed.");
    }

    return text;
  }

  function bindForm(card){
    const form = card.querySelector("#cx-real-lead-form");
    const status = card.querySelector("#cx-real-lead-status");
    const button = card.querySelector(".cx-real-lead-submit");

    form.addEventListener("submit", async function(e){
      e.preventDefault();

      status.className = "cx-real-lead-status";
      status.textContent = "";

      const fd = new FormData(form);

      const payload = {
        full_name: String(fd.get("full_name") || "").trim(),
        email: String(fd.get("email") || "").trim(),
        phone: String(fd.get("phone") || "").trim(),
        company: String(fd.get("brand_name") || "").trim(),
        brand_name: String(fd.get("brand_name") || "").trim(),
        campaign_type: String(fd.get("campaign_type") || "").trim(),
        budget: String(fd.get("budget") || "").trim(),
        message: String(fd.get("message") || "").trim(),
        source_page: location.pathname || "/",
        raw_payload: {
          full_name: String(fd.get("full_name") || "").trim(),
          email: String(fd.get("email") || "").trim(),
          phone: String(fd.get("phone") || "").trim(),
          brand_name: String(fd.get("brand_name") || "").trim(),
          campaign_type: String(fd.get("campaign_type") || "").trim(),
          budget: String(fd.get("budget") || "").trim(),
          message: String(fd.get("message") || "").trim(),
          source_page: location.pathname || "/"
        }
      };

      if(!payload.email){
        status.className = "cx-real-lead-status err";
        status.textContent = "Email is required.";
        return;
      }

      try{
        button.disabled = true;
        button.textContent = "Submitting...";

        await submitLead(payload);

        console.log("[Clipency Lead Form] Lead saved:", payload);

        status.className = "cx-real-lead-status ok";
        status.textContent = "Submitted successfully.";

        setTimeout(() => showSuccess(card), 500);
      }catch(error){
        console.error("[Clipency Lead Form] Failed:", error); alert("Lead submit failed: " + (error.message || error));
        status.className = "cx-real-lead-status err";
        status.textContent = "Could not submit lead: " + (error.message || error);
        button.disabled = false;
        button.textContent = "Submit inquiry →";
      }
    });
  }

  function mount(){
    if(mounted) return;

    const card = findPipelineCard();

    if(!card){
      console.warn("[Clipency Lead Form] Pipeline card not found.");
      return;
    }

    mounted = true;
    renderForm(card);

    window.cxLandingLeadFormReady = true;
    console.log("[Clipency Lead Form] Mounted real landing lead form.");
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", mount);
  }else{
    mount();
  }

  window.addEventListener("load", mount);
  setTimeout(mount, 800);
  setTimeout(mount, 1800);
})();
