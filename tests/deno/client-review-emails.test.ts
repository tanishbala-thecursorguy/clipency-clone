/* Rendering tests for supabase/functions/client-review-emails.
 * Run: SUPABASE_URL=http://x SUPABASE_SERVICE_ROLE_KEY=k SUPABASE_ANON_KEY=a \
 *      deno test -A --import-map=tests/deno/import_map.json tests/deno/client-review-emails.test.ts */
import { render, fmtWhen, esc } from "../../supabase/functions/client-review-emails/index.ts";
import { campName, compact, fmtLeft, fmtWeek, KINDS, money, samples } from "../../supabase/functions/client-review-emails/templates.ts";
import { countdownGif, hms } from "../../supabase/functions/email-countdown/index.ts";

function ok(c: boolean, n: string, x?: unknown) { if (!c) throw new Error(n + " " + JSON.stringify(x)); }
const NOW = Date.parse("2026-10-01T12:00:00Z");
const CTX = { portal: "https://www.clipency.in/client", clipper: "https://www.clipency.in/client/clipper.html",
  countdown: "https://spwtkdgpgeutrhwcjrpy.supabase.co/functions/v1/email-countdown", now: NOW };
const clips = [
  { handle: "@mercy", platform: "instagram", url: "https://www.instagram.com/reel/AAA/", due: "2026-10-01T14:11:00Z" },
  { handle: "<script>x</script>", platform: "youtube", url: "javascript:alert(1)", due: "2026-10-01T21:00:00Z" },
  { handle: "@three", platform: "tiktok", url: "https://www.tiktok.com/@a/video/1", due: "2026-10-03T16:00:00Z" },
];
const CID = "e18bb5d9-5ec8-416b-97a3-558275e3fd61";
const base = { campaign_id: CID, campaign: "Vingo {UGC Campaign}", count: 23, milestone: 20, window_hours: 48,
  first_due: "2026-10-01T14:11:00Z", timezone: "Asia/Kolkata", clips };
const all = (m: { subject: string; html: string; text: string }) => m.subject + m.html + m.text;

Deno.test("milestone: real count, next milestone, soonest first with time left", () => {
  const m = render("review_milestone", base, CTX);
  ok(m.subject === "23 clips are waiting for your review on Vingo", "subject", m.subject);
  ok(m.html.includes(`href="https://www.clipency.in/client/campaign.html?view=review&amp;campaign=${CID}"`), "review link");
  ok(m.html.includes("Thu 1 Oct, 7:41 pm IST"), "first due in IST");
  ok(m.html.includes("Auto-approves in 2h 11m") && m.html.includes("Auto-approves in 9h 00m") && m.html.includes("Auto-approves in 2d 4h"), "per clip time left");
  ok(m.html.includes("color:#a0521f;\">Auto-approves in 2h 11m"), "under 6h is highlighted");
  ok(m.html.includes("We email you again when 30 are waiting."), "next milestone");
  ok(m.html.includes("approved automatically 48 hours after"), "window hours");
  ok(m.html.includes("and 20 more in Review"), "more line");
  ok(m.text.includes(`Review now: https://www.clipency.in/client/campaign.html?view=review&campaign=${CID}`), "text link");
});
Deno.test("daily digest: one summary, says it is daily, no next-milestone promise", () => {
  const m = render("review_digest", { ...base, count: 24, milestone: undefined }, CTX);
  ok(m.subject === "24 clips are waiting for your review on Vingo", "subject", m.subject);
  ok(m.html.includes("one email a day while clips are waiting") && !m.html.includes("We email you again when"), "daily wording");
  ok(m.html.includes("Sent once a day while clips are waiting"), "footer reason");
  ok(m.html.includes("Auto-approves in 2h 11m") && m.html.includes("and 21 more in Review"), "soonest first, rest counted");
});
Deno.test("approvals summary: count, campaign, every clip linked, no money", () => {
  const appr = { count: 3, timezone: "Asia/Kolkata", digest: true, campaign: "Vingo {UGC Campaign}",
    clips: [
      { campaign: "Vingo {UGC Campaign}", handle: "@mercy", platform: "instagram", url: "https://www.instagram.com/reel/A1/", decided_at: "2026-10-01T05:00:00Z" },
      { campaign: "Vingo {UGC Campaign}", handle: "@mercy", platform: "youtube", url: "https://www.youtube.com/shorts/B2", decided_at: "2026-10-01T06:00:00Z" },
      { campaign: "Vingo {UGC Campaign}", handle: "<b>x</b>", platform: "instagram", url: "javascript:alert(1)", decided_at: "2026-10-01T07:00:00Z" } ] };
  const m = render("clips_approved", appr as never, CTX);
  ok(m.subject === "Approved: 3 of your clips for Vingo", "subject", m.subject);
  ok(m.html.includes("3 clips approved.") && m.html.includes("instagram.com/reel/A1/") && m.html.includes("youtube.com/shorts/B2"), "lists clips");
  ok(m.html.includes("YouTube Short") && m.html.includes("Instagram reel"), "kind per clip");
  ok(!m.html.includes("<b>x</b>") && !all(m).includes("javascript:"), "escaped, unsafe link dropped");
  ok(m.html.includes("Sent once 5 of your clips are approved") && !/today|once a day/.test(all(m)), "footer reason, no daily wording");
  const multi = render("clips_approved", { ...appr, campaign: undefined } as never, CTX);
  ok(multi.subject === "Approved: 3 of your clips", "several campaigns", multi.subject);
});
Deno.test("approvals batch: 23 approved, the 10 latest listed, the rest counted", () => {
  const clips = Array.from({ length: 10 }, (_, i) => ({ campaign: "Vingo", handle: "@mercy", platform: "instagram",
    url: `https://www.instagram.com/reel/L${i}/`, decided_at: "2026-10-01T05:00:00Z" }));
  const m = render("clips_approved", { count: 23, timezone: "Asia/Kolkata", campaign: "Vingo", clips } as never, CTX);
  ok(m.subject === "Approved: 23 of your clips for Vingo" && m.html.includes("23 clips approved."), "count is the whole batch", m.subject);
  ok(m.html.includes("reel/L9/") && m.html.includes("and 13 more in your dashboard") && m.text.includes("and 13 more in your dashboard"), "13 more, html and text");
  ok(m.html.includes("Latest approved"), "label says latest");
});
Deno.test("milestone: paused campaign says on hold, no auto-approve promise", () => {
  const m = render("review_milestone", { ...base, paused: true }, CTX);
  ok(m.html.includes("Auto-approval is on hold") && !m.html.includes("Auto-approves in"), "paused");
});
Deno.test("reminder uses the client's timezone, singular reads right", () => {
  const m = render("reminder", { ...base, count: 2 }, CTX);
  ok(m.subject === "2 clips on Vingo approve automatically at 7:41 pm IST unless you act", "reminder", m.subject);
  const ny = render("reminder", { ...base, count: 1, timezone: "America/New_York" }, CTX);
  ok(/1 clip on .+ approves automatically at 10:11 am (EDT|EST) unless you act/.test(ny.subject), "NY", ny.subject);
  ok(fmtWhen(base.first_due, "Not/AZone").time === "7:41 pm IST", "bad tz falls back");
});
Deno.test("weekly: numbers, deltas, currency, week range, top clips", () => {
  const p = { campaign_id: CID, campaign: "Vingo", timezone: "Asia/Kolkata",
    week_start: "2026-09-20T18:30:00Z", week_end: "2026-09-27T18:29:59Z",
    views: 156928, views_prev: 75202, approved: 81, approved_prev: 90, live: 144, creators: 23, waiting: 4, rejected: 6, auto: 2,
    currency: "INR", spent: 36000, budget: 125000,
    top: [{ handle: "@a", url: "https://www.instagram.com/reel/X/", views: 52000, likes: 3100, gain: 41000 }] };
  const m = render("weekly_report", p, CTX);
  ok(m.subject === "Your week on Vingo: 156.9K views, 81 clips approved", "subject", m.subject);
  ok(m.html.includes("Monday 21 to Sunday 27 September"), "week range", m.html.match(/<p style="margin:0;font-size:15px[^>]*>[^<]+/)?.[0]);
  ok(m.html.includes("&#9650; 109% on last week"), "views up");
  ok(m.html.includes("&#9660; 9 on last week"), "approved down");
  ok(m.html.includes("₹36,000") && m.html.includes("of ₹1,25,000 budget"), "INR lakh format");
  ok(m.html.includes("+41K views this week"), "top gain");
  ok(m.html.includes(`view=overview&amp;campaign=${CID}`), "dashboard link");
  const empty = render("weekly_report", { ...p, top: [], views_prev: 0, views: 0, budget: 0, currency: "USD", spent: 12.5 }, CTX);
  ok(!empty.html.includes("Top clips this week") && empty.html.includes("No new views") && empty.html.includes("$12.50"), "empty week");
  ok(fmtWeek("2026-09-27T18:30:00Z", "2026-10-04T18:29:59Z", "Asia/Kolkata").long === "Monday 28 September to Sunday 4 October", "cross month");
});
Deno.test("approved: facts, no earnings", () => {
  const m = render("clip_approved", { campaign: "Vingo", handle: "@mercy", platform: "instagram", url: "https://www.instagram.com/reel/AAA/",
    decided_at: "2026-09-30T12:11:00Z", timezone: "Asia/Kolkata" }, CTX);
  ok(m.subject === "Approved: your clip for Vingo", "subject", m.subject);
  ok(m.html.includes("Wed 30 Sep, 5:41 pm IST") && m.html.includes("Instagram reel &#8599;"), "facts");
  ok(m.html.includes('href="https://www.clipency.in/client/clipper.html"'), "clipper link");
});
Deno.test("rejected: reason, brand, countdown image, deadline text", () => {
  const p = { campaign: "Vingo", handle: "@mercy", platform: "instagram", url: "https://www.instagram.com/reel/AAA/",
    decided_at: "2026-09-30T12:11:00Z", deadline: "2026-10-01T12:11:00Z", timezone: "Asia/Kolkata",
    reason: "Wrong <b>pack</b>", by_brand: true };
  const m = render("clip_rejected", p, CTX);
  ok(m.html.includes("Reason from Vingo") && m.html.includes("Wrong &lt;b&gt;pack&lt;/b&gt;"), "reason escaped");
  ok(m.html.includes(`src="${CTX.countdown}?until=2026-10-01T12%3A11%3A00Z"`) && m.html.includes('width="280" height="60"'), "countdown img");
  ok(m.html.includes("Resubmit before <b style=\"color:#14120e;\">Thu 1 Oct, 5:41 pm IST</b>"), "deadline text");
  ok(m.html.includes("Vingo did not approve your Instagram reel for @mercy."), "brand intro names the kind of clip");
  ok(m.html.includes('href="https://www.instagram.com/reel/AAA/"') && m.html.includes("Open the rejected Instagram reel &#8599;") &&
     m.html.includes("Instagram reel &#8599;") && m.html.includes("Wed 30 Sep, 5:41 pm IST"), "which clip: the post as a line and a button, and when it was rejected");
  ok(m.text.includes("The rejected Instagram reel: https://www.instagram.com/reel/AAA/"), "text version names the post");
  const noUrl = render("clip_rejected", { ...p, url: null }, CTX);
  ok(!noUrl.html.includes("Open the rejected") && noUrl.html.includes("Reason from Vingo"), "no url: no button, still the reason");
  const staff = render("clip_rejected", { ...p, by_brand: false, reason: null }, CTX);
  ok(staff.html.includes("Reason from the Clipency team") && staff.html.includes("No reason was given"), "staff, no reason");
  ok(staff.html.includes("Your clip for @mercy for Vingo was not approved.") || staff.html.includes("was not approved."), "staff intro");
});
Deno.test("private approved: account and platform", () => {
  const m = render("private_approved", { campaign: "Vingo", handle: "@mercy", platform: "instagram" }, CTX);
  ok(m.subject === "You're in: Vingo", "subject");
  ok(m.html.includes("Instagram Reels") && m.html.includes("Post from @mercy") && m.html.includes("for @mercy only"), "facts");
  const bare = render("private_approved", { campaign: "Vingo" }, CTX);
  ok(bare.html.includes("your approved account"), "no handle");
});
Deno.test("no html injection, no unsafe links", () => {
  const m = render("review_milestone", base, CTX);
  ok(!m.html.includes("<script>") && m.html.includes("&lt;script&gt;"), "escaped handle");
  ok(!all(m).includes("javascript:"), "js url dropped");
  ok(esc(`"'<>&`) === "&quot;&#39;&lt;&gt;&amp;", "esc");
  const r = render("clip_approved", { campaign: "<img src=x>", url: "javascript:1" }, CTX);
  ok(!r.html.includes("<img src=x>") && !r.html.includes("javascript:"), "creator escaped");
});
Deno.test("no creator money in any email, no em dash anywhere", () => {
  const S = samples(NOW);
  for (const k of KINDS) {
    const m = render(k, S[k], CTX);
    const a = all(m);
    ok(!/\b(rate|payout|fee|fees|pool|earn|earns|earning|earnings|per video|per view)\b/i.test(a), "money words " + k, a.match(/\b(rate|payout|fee|pool|earn\w*|per video|per view)\b/i)?.[0]);
    if (k !== "weekly_report") ok(!/[$₹€£]/.test(a), "currency sign " + k);
    ok(!a.includes("\u2014"), "em dash " + k);
  }
});
Deno.test("real-data shapes: tags stripped, tracking ended, flag-form reasons", () => {
  ok(campName("Vingo {UGC Campaign}") === "Vingo" && campName("Tal's Pod [Podcast]") === "Tal's Pod" && campName("[Only]") === "[Only]", "campName");
  const w = render("weekly_report", { campaign: "Tal's Pod [Podcast]", views: 0, views_prev: 0, views_total: 350320, tracking: 0, approved: 0,
    approved_prev: 0, live: 78, creators: 10, waiting: 6, currency: "USD", spent: 310, budget: 400,
    top: [{ handle: "@a", url: "https://www.instagram.com/reel/X/", views: 50340, likes: 152, gain: 0 }] }, CTX);
  ok(w.subject === "Your week on Tal's Pod: 350.3K total views, 0 clips approved", "tracking ended subject", w.subject);
  ok(w.html.includes("Total views") && w.html.includes("No views tracked this week") && w.html.includes("Top clips so far") && !w.html.includes("[Podcast]"), "tracking ended body");
  const live = render("weekly_report", { campaign: "Vingo", views: 10, tracking: 5, views_total: 99 }, CTX);
  ok(live.html.includes("Views this week") && !live.html.includes("Total views"), "tracking on");
  const r = render("clip_rejected", { campaign: "Vingo {UGC Campaign}", reason: "Low quality / poor edit \u2014 Boyfriend script repetition.", by_brand: true,
    deadline: "2026-10-01T12:11:00Z" }, CTX);
  ok(r.html.includes("Low quality / poor edit: Boyfriend script repetition.") && r.html.includes("Reason from Vingo") && !(r.subject + r.html + r.text).includes("\u2014"), "reason cleaned");
});
Deno.test("helpers", () => {
  ok(compact(156928) === "156.9K" && compact(999) === "999" && compact(1_250_000) === "1.3M" && compact(184200) === "184.2K", "compact");
  ok(money(125000, "INR") === "₹1,25,000" && money(0.63, "usd") === "$0.63", "money");
  ok(fmtLeft("2026-10-01T12:30:00Z", NOW) === "30m" && fmtLeft("2026-09-30T00:00:00Z", NOW) === "0m", "left");
  ok(hms(86399) === "23:59:59" && hms(-5) === "00:00:00" && hms(1e9) === "99:59:59", "hms");
});
Deno.test("countdown gif is a valid GIF89a with the right frames", () => {
  const g = countdownGif(86399);
  ok(String.fromCharCode(...g.slice(0, 6)) === "GIF89a" && g[g.length - 1] === 0x3b, "header/trailer");
  let frames = 0; for (let i = 0; i < g.length - 1; i++) if (g[i] === 0x21 && g[i + 1] === 0xf9 && g[i + 2] === 4) frames++;
  ok(frames === 60, "60 frames", frames);
  const done = countdownGif(0);
  let f0 = 0; for (let i = 0; i < done.length - 1; i++) if (done[i] === 0x21 && done[i + 1] === 0xf9 && done[i + 2] === 4) f0++;
  ok(f0 === 1, "expired = one still frame", f0);
});
