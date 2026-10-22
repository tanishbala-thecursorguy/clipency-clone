(function(){
  window.CLIPENCY_LAUNCH_PASSIVE = "launch-passive-v1";

  function clean(v){
    return String(v || "").replace(/\s+/g, " ").trim();
  }

  function path(){
    return location.pathname.replace(/\/+$/, "").toLowerCase();
  }

  function isCampaignPage(){
    return path().includes("/campaign");
  }

  function isAdminReviewPage(){
    return path() === "/admin/review" || path() === "/admin/reviews";
  }

  function sb(){
    return window.clipencySupabase || window.supabaseClient || window.sbClient || null;
  }

  async function rpc(name, payload){
    const client = sb();

    if(!client?.rpc){
      throw new Error("Supabase client missing.");
    }

    const { data, error } = await client.rpc(name, payload || {});

    if(error){
      throw error;
    }

    return data;
  }

  function findUrl(scope){
    if(!scope) return "";

    for(const el of scope.querySelectorAll("input, textarea")){
      const v = clean(el.value);
      if(/^https?:\/\//i.test(v)) return v;
    }

    return "";
  }

  function findHandle(scope){
    if(!scope) return "";

    for(const el of scope.querySelectorAll("input, textarea")){
      const meta = clean(`${el.name || ""} ${el.id || ""} ${el.placeholder || ""}`).toLowerCase();
      const v = clean(el.value);

      if(v && /(handle|username|account|profile)/.test(meta)){
        return v;
      }
    }

    return "";
  }

  function campaignTitle(){
    const candidates = [
      document.querySelector(".campaign-title")?.textContent,
      document.querySelector("[data-campaign-title]")?.dataset?.campaignTitle,
      document.querySelector("h1")?.textContent,
      document.querySelector("h2")?.textContent
    ];

    for(const c of candidates){
      const v = clean(c);
      if(v && !/^campaigns$/i.test(v) && !/^clipency$/i.test(v)) return v;
    }

    return "Campaign";
  }

  function campaignId(){
    return clean(
      document.querySelector("[data-campaign-id]")?.dataset?.campaignId ||
      new URLSearchParams(location.search).get("campaign_id") ||
      new URLSearchParams(location.search).get("id") ||
      ""
    );
  }

  function platform(){
    const txt = clean(document.body.textContent).toLowerCase();
    if(txt.includes("youtube")) return "YouTube";
    if(txt.includes("tiktok")) return "TikTok";
    if(txt.includes("instagram")) return "Instagram";
    return "Instagram";
  }

  async function submitClip(scope){
    const url = findUrl(scope);

    if(!url){
      return false;
    }

    await rpc("clipency_launch_submit_clip", {
      p_campaign_id: campaignId(),
      p_campaign_title: campaignTitle(),
      p_post_url: url,
      p_platform: platform(),
      p_account_handle: findHandle(scope)
    });

    alert("Clip submitted successfully. It is now pending review.");

    if(scope instanceof HTMLFormElement){
      scope.reset();
    }

    return true;
  }

  function bindCampaignSubmit(){
    if(!isCampaignPage()) return;

    window.addEventListener("submit", async function(e){
      const form = e.target;

      if(!(form instanceof HTMLFormElement)) return;

      const url = findUrl(form);

      if(!url) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      try{
        await submitClip(form);
      }catch(error){
        console.error("[Clipency Passive Submit]", error);
        alert("Clip submission failed: " + (error.message || error));
      }
    }, true);

    window.addEventListener("click", async function(e){
      const btn = e.target.closest("button,a,[role='button']");
      if(!btn) return;

      const text = clean(btn.textContent).toLowerCase();

      if(
        !text.includes("submit") &&
        !text.includes("upload") &&
        !text.includes("send")
      ){
        return;
      }

      const scope =
        btn.closest("form") ||
        btn.closest(".modal,.dialog,.popup,[role='dialog'],.drawer,.submit-modal");

      // Important: if this is the main CTA and no URL field exists yet,
      // do not block old UI/modal.
      if(!scope || !findUrl(scope)){
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      try{
        await submitClip(scope);
      }catch(error){
        console.error("[Clipency Passive Submit]", error);
        alert("Clip submission failed: " + (error.message || error));
      }
    }, true);
  }

  async function pendingRows(){
    const rows = await rpc("clipency_launch_admin_review_queue", {});
    return (Array.isArray(rows) ? rows : []).filter(r => {
      const s = String(r.review_status || r.status || "").toLowerCase();
      return s === "pending";
    });
  }

  function buttonIndex(btn, label){
    const buttons = Array.from(document.querySelectorAll("button,a,[role='button']"))
      .filter(b => clean(b.textContent).toLowerCase() === label);

    return Math.max(0, buttons.indexOf(btn));
  }

  function bindAdminReview(){
    if(!isAdminReviewPage()) return;

    window.addEventListener("click", async function(e){
      const btn = e.target.closest("button,a,[role='button']");
      if(!btn) return;

      const text = clean(btn.textContent).toLowerCase();

      if(text !== "approve" && text !== "reject") return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      try{
        const rows = await pendingRows();
        const row = rows[buttonIndex(btn, text)];

        if(!row?.id){
          alert("Could not find this pending submission. Refresh once.");
          return;
        }

        if(text === "approve"){
          const entered = prompt("Enter earning amount for this approved clip:", "0");
          if(entered === null) return;

          const amount = Number(String(entered).replace(/[^0-9.]/g, ""));

          if(Number.isNaN(amount) || amount < 0){
            alert("Enter a valid amount.");
            return;
          }

          await rpc("clipency_launch_approve_submission", {
            p_submission_id: row.id,
            p_earning: amount
          });

          alert("Submission approved.");
          location.reload();
          return;
        }

        const reason = prompt("Enter rejection reason:");
        if(reason === null) return;

        await rpc("clipency_launch_reject_submission", {
          p_submission_id: row.id,
          p_reason: reason
        });

        alert("Submission rejected.");
        location.reload();
      }catch(error){
        console.error("[Clipency Passive Admin]", error);
        alert("Admin action failed: " + (error.message || error));
      }
    }, true);
  }

  bindCampaignSubmit();
  bindAdminReview();
})();
