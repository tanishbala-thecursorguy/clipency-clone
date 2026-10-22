// Clipency transactional emails, on the Clipathon sign-in email layout.
// Tables and inline styles only: Gmail and Outlook strip <style> blocks.
// Mirrors clipency-emails/build.py (the designed samples). Never shows a
// creator rate, payout, pool or platform fee.

export const ASSETS = "https://kszlfvsplkkmsgxqnakj.supabase.co/storage/v1/object/public/assets";
export const SITE = "https://www.clipency.in";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export const safeUrl = (u: unknown) => (typeof u === "string" && /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : "");
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
/** "Vingo {UGC Campaign}" -> "Vingo", "Tal's Pod [Podcast]" -> "Tal's Pod": internal tags stay out of emails. */
export const campName = (v: unknown) => {
  const raw = String(v ?? "").trim();
  const clean = raw.replace(/\s*[\[{(][^\]})]*[\]})]/g, "").replace(/\s{2,}/g, " ").trim();
  return clean || raw;
};
const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : 0; };

/* ---------------- dates ---------------- */

function zoneOf(tz: string) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return "Asia/Kolkata"; }
}
function abbrOf(d: Date, zone: string) {
  if (zone === "Asia/Kolkata" || zone === "Asia/Calcutta") return "IST";
  const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
    .formatToParts(d).find((p) => p.type === "timeZoneName");
  return part ? part.value : zone;
}
function parts(d: Date, zone: string) {
  // Built from parts: ICU versions disagree on commas between them.
  const dp = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", day: "numeric", month: "short", year: "numeric" }).formatToParts(d);
  const pick = (t: string) => dp.find((x) => x.type === t)?.value ?? "";
  const long = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "long", month: "long" }).formatToParts(d);
  const pickL = (t: string) => long.find((x) => x.type === t)?.value ?? "";
  return { wd: pick("weekday"), day: pick("day"), mon: pick("month").replace(/^Sept$/, "Sep"), year: pick("year"), wdLong: pickL("weekday"), monLong: pickL("month") };
}

export function fmtWhen(iso: string | null | undefined, tz: string): { time: string; full: string } {
  if (!iso) return { time: "", full: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { time: "", full: "" };
  const zone = zoneOf(tz);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true })
    .format(d).replace(" AM", " am").replace(" PM", " pm");
  const p = parts(d, zone), abbr = abbrOf(d, zone);
  return { time: `${time} ${abbr}`, full: `${p.wd} ${p.day} ${p.mon}, ${time} ${abbr}` };
}

/** "Monday 21 to Sunday 27 September", or across months "Monday 28 September to Sunday 4 October". */
export function fmtWeek(startIso: string | undefined, endIso: string | undefined, tz: string) {
  const a = new Date(startIso ?? ""), b = new Date(endIso ?? "");
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return { long: "Last week", short: "last week" };
  const zone = zoneOf(tz), p = parts(a, zone), q = parts(b, zone);
  const long = p.monLong === q.monLong
    ? `${p.wdLong} ${p.day} to ${q.wdLong} ${q.day} ${q.monLong}`
    : `${p.wdLong} ${p.day} ${p.monLong} to ${q.wdLong} ${q.day} ${q.monLong}`;
  const short = p.mon === q.mon ? `${p.day} to ${q.day} ${q.mon}` : `${p.day} ${p.mon} to ${q.day} ${q.mon}`;
  return { long, short };
}

/** "2h 14m", "1d 3h", "12m". */
export function fmtLeft(iso: string | null | undefined, now = Date.now()) {
  const t = Date.parse(iso ?? "");
  if (isNaN(t)) return "";
  const m = Math.max(0, Math.round((t - now) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/* ---------------- numbers ---------------- */

export function compact(n: number) {
  n = num(n);
  const a = Math.abs(n);
  const f = (v: number, s: string) => v.toFixed(1).replace(/\.0$/, "") + s;
  if (a >= 1e9) return f(n / 1e9, "B");
  if (a >= 1e6) return f(n / 1e6, "M");
  if (a >= 1e3) return f(n / 1e3, "K");
  return String(Math.round(n));
}

export function money(v: unknown, cur: string) {
  const n = num(v), c = (cur || "USD").toUpperCase();
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  try {
    return new Intl.NumberFormat(c === "INR" ? "en-IN" : "en-US", {
      style: "currency", currency: c, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2,
    }).format(n);
  } catch { return `${c} ${n.toFixed(2)}`; }
}

const platformName = (p: unknown) => {
  const s = String(p ?? "").toLowerCase();
  return s.includes("insta") ? "Instagram" : s.includes("you") ? "YouTube" : s.includes("tik") ? "TikTok" : s ? s[0].toUpperCase() + s.slice(1) : "";
};
const formatName = (p: unknown) => {
  const s = String(p ?? "").toLowerCase();
  return s.includes("insta") ? "Instagram Reels" : s.includes("you") ? "YouTube Shorts" : s.includes("tik") ? "TikTok" : platformName(p);
};
const clipKind = (p: unknown) => {
  const s = String(p ?? "").toLowerCase();
  return s.includes("insta") ? "Instagram reel" : s.includes("you") ? "YouTube Short" : s.includes("tik") ? "TikTok video" : "Your clip";
};

/* ---------------- building blocks ---------------- */

export interface Layout {
  label: string; preheader: string; title: string; intro: string; body: string;
  cta_text: string; cta_href: string; cta_note?: string; note?: string; fine: string; reason: string;
}

export function layout(o: Layout) {
  const ctaNote = o.cta_note
    ? `<p style="margin:11px 0 0;text-align:center;font-size:12px;line-height:1.6;color:#a09a90;">${o.cta_note}</p>` : "";
  const note = o.note
    ? `<tr><td style="padding:18px 38px 0;"><p style="margin:0;font-size:13.5px;line-height:1.62;color:#8a8378;">${o.note}</p></td></tr>` : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:#faf9f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#faf9f6;font-size:1px;line-height:1px;">${esc(o.preheader)}&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf9f6;margin:0;padding:34px 12px;font-family:${SANS};">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:504px;background:#ffffff;border:1px solid #e8e4db;border-radius:18px;overflow:hidden;">
      <tr><td style="background:#f6f3ec;padding:20px 38px;border-bottom:1px solid #e8e4db;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:middle;"><img src="${ASSETS}/clipency-logo-chip.png" width="155" height="54" alt="Clipency" style="display:block;width:155px;height:54px;border:0;outline:none;text-decoration:none;color:#14120e;font-size:16px;font-weight:700;letter-spacing:.15em;font-family:${SERIF};"></td>
          <td style="vertical-align:middle;padding:0 14px;"><span style="color:#c9c0b0;font-size:16px;">&#124;</span></td>
          <td style="vertical-align:middle;"><span style="font-family:${SERIF};font-size:11px;letter-spacing:.26em;color:#8a6224;text-transform:uppercase;">${esc(o.label)}</span></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:26px 38px 0;">
        <h1 style="margin:0 0 9px;font-family:${SERIF};font-weight:400;font-size:28px;line-height:1.16;color:#14120e;">${o.title}</h1>
        <p style="margin:0;font-size:15px;line-height:1.62;color:#5a554c;">${o.intro}</p>
      </td></tr>
${o.body}
      <tr><td style="padding:22px 38px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" style="background:#14120e;border-radius:12px;"><a href="${esc(o.cta_href)}" style="display:block;padding:15px 22px;color:#f3efe7;font-size:15px;font-weight:600;letter-spacing:.01em;text-decoration:none;">${o.cta_text}</a></td>
        </tr></table>
        ${ctaNote}
      </td></tr>
${note}
      <tr><td style="padding:22px 38px 0;"><div style="height:1px;background:#eeeae1;"></div></td></tr>
      <tr><td style="padding:18px 38px 30px;"><p style="margin:0;font-size:12.5px;line-height:1.62;color:#a09a90;">${o.fine}</p></td></tr>
      <tr><td style="background:#14120e;padding:26px 38px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="padding-bottom:16px;">
            <span style="font-family:${SERIF};font-size:13px;font-weight:700;letter-spacing:.16em;color:#f3efe7;text-transform:uppercase;">Clipency</span>
            <div style="margin-top:6px;font-size:12.5px;line-height:1.6;color:#8f887c;">Short-form clips, paid on performance.</div>
          </td></tr>
          <tr><td style="padding-bottom:16px;">
            <a href="https://www.instagram.com/clipency" style="display:block;text-decoration:none;width:22px;"><img src="${ASSETS}/social-instagram.png" width="22" height="22" alt="Instagram" style="display:block;width:22px;height:22px;border:0;outline:none;text-decoration:none;color:#D8AA74;font-size:12px;font-family:Arial,Helvetica,sans-serif;"></a>
          </td></tr>
          <tr><td>
            <div style="height:1px;background:#2a2622;margin-bottom:14px;"></div>
            <p style="margin:0;font-size:11.5px;line-height:1.65;color:#6e6860;">
              <a href="${SITE}" style="color:#8a8177;text-decoration:underline;">clipency.in</a> &#183; <a href="${SITE}/clipathon" style="color:#8a8177;text-decoration:underline;">Clipathon</a>
              <br>&copy; 2026 Clipency, Inc. All rights reserved.<br>${o.reason} This mailbox is not monitored.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

const row = (inner: string, top = 24) => `      <tr><td style="padding:${top}px 38px 0;">${inner}</td></tr>`;
const panel = (inner: string, pad = "22px 22px", bg = "#f6f3ec", border = "#e6e1d6") =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${bg};border:1px solid ${border};border-radius:14px;"><tr><td style="padding:${pad};">${inner}</td></tr></table>`;
const bigNumber = (n: string, caption: string, sub: string) => panel(
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="padding:6px 0 4px;font-family:${SERIF};font-size:54px;line-height:1;color:#14120e;">${n}</td></tr>
    <tr><td align="center" style="padding:6px 0 0;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#8a6224;">${caption}</td></tr>
    ${sub ? `<tr><td align="center" style="padding:10px 0 2px;font-size:13px;line-height:1.55;color:#5a554c;">${sub}</td></tr>` : ""}
  </table>`, "22px 16px 18px");
const sectionLabel = (t: string) => `<div style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#9a9287;margin:0 0 8px;">${t}</div>`;
function listRows(items: [string, string, string][]) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items.map(([l, s, r], i) => {
    const bt = i === 0 ? "" : "border-top:1px solid #eeeae1;";
    return `<tr><td style="padding:11px 0;${bt}font-size:14px;line-height:1.45;color:#14120e;">${l}${s ? `<div style="font-size:12.5px;color:#8a8378;margin-top:2px;">${s}</div>` : ""}</td>` +
      `<td align="right" style="padding:11px 0 11px 12px;${bt}font-size:13px;white-space:nowrap;vertical-align:top;">${r}</td></tr>`;
  }).join("")}</table>`;
}
function facts(pairs: [string, string][]) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${pairs.map(([k, v], i) => {
    const bt = i === 0 ? "" : "border-top:1px solid #e6e1d6;";
    return `<tr><td style="padding:10px 0;${bt}font-size:12.5px;color:#8a8378;vertical-align:top;">${k}</td>` +
      `<td align="right" style="padding:10px 0 10px 14px;${bt}font-size:14px;color:#14120e;font-weight:600;word-break:break-word;">${v}</td></tr>`;
  }).join("")}</table>`;
}
const watch = (u: unknown) => { const s = safeUrl(u); return s ? `<a href="${esc(s)}" style="color:#8a6224;text-decoration:none;">Watch &#8599;</a>` : ""; };
const steps = (xs: [string, string][]) => listRows(xs.map(([a, b], i) => [`<b style="font-weight:600;">${i + 1}.&nbsp; ${a}</b>`, b, ""]));

/* ---------------- payloads ---------------- */

export interface Clip { handle?: string | null; platform?: string | null; url?: string | null; due?: string | null }
export interface Top { handle?: string; platform?: string; url?: string; views?: number; likes?: number; gain?: number }
export interface Payload {
  campaign_id?: string; campaign?: string; count?: number; milestone?: number; first_due?: string | null;
  timezone?: string; paused?: boolean; window_hours?: number; clips?: Clip[];
  // weekly
  week_start?: string; week_end?: string; views?: number; views_prev?: number; views_total?: number; tracking?: number;
  approved?: number; approved_prev?: number;
  live?: number; creators?: number; waiting?: number; rejected?: number; auto?: number;
  currency?: string; spent?: number; budget?: number; top?: Top[];
  // creator
  handle?: string | null; platform?: string | null; url?: string | null; decided_at?: string | null;
  reason?: string | null; by_brand?: boolean; deadline?: string | null;
  digest?: boolean;
}
export interface Approval { campaign?: string | null; handle?: string | null; platform?: string | null; url?: string | null; decided_at?: string | null }
export interface Ctx { portal: string; clipper: string; countdown: string; now?: number }
export interface Mail { subject: string; html: string; text: string }

const text = (...lines: (string | false | null | undefined)[]) =>
  lines.filter((l) => l !== false && l !== null && l !== undefined).join("\n")
    .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#8599;/g, "").replace(/&middot;/g, "·").replace(/&nbsp;/g, " ");

function clientFine(camp: string, portal: string) {
  return `You get this because you have access to ${esc(camp)} on your Clipency dashboard. Choose which emails you get, or where they go, in your ` +
    `<a href="${esc(portal)}/profile.html" style="color:#8a8378;text-decoration:underline;">Profile</a>.`;
}
const CREATOR_FINE = "You get this because you submitted clips with this Clipency account. Updates about your clips always come from this address.";

/* ---------------- 1. reviews waiting (every 10) and the 6-hour reminder ---------------- */

function reviewList(p: Payload, now: number, shown: number) {
  const clips = (p.clips || []).slice(0, 5);
  const rows = clips.map((c): [string, string, string] => {
    const left = fmtLeft(c.due, now), soon = Date.parse(c.due ?? "") - now < 6 * 3600e3;
    const plat = String(c.platform || "").toLowerCase();
    return [
      `<b style="font-weight:600;">${esc(c.handle || "A creator")}</b>${plat ? `<span style="color:#9a9287;"> &middot; ${esc(plat)}</span>` : ""}`,
      p.paused ? `<span style="color:#8a8378;">On hold while the campaign is paused</span>`
        : left ? `<span style="color:${soon ? "#a0521f" : "#8a8378"};">Auto-approves in ${left}</span>` : "",
      watch(c.url),
    ];
  });
  const more = shown - clips.length;
  return sectionLabel("Soonest first") + listRows(rows) +
    (more > 0 ? `<div style="font-size:12.5px;color:#8a8378;padding-top:10px;border-top:1px solid #eeeae1;">and ${more} more in Review</div>` : "");
}

function reviewMilestone(p: Payload, c: Ctx): Mail {
  const now = c.now ?? Date.now();
  const n = Math.max(1, num(p.count) || (p.clips?.length ?? 1));
  const m = num(p.milestone) || Math.floor(n / 10) * 10;
  const camp = (campName(p.campaign) || "your campaign"), tz = p.timezone || "Asia/Kolkata";
  const when = fmtWhen(p.first_due, tz), hours = num(p.window_hours) || 48;
  const href = `${c.portal}/campaign.html?view=review` + (p.campaign_id ? `&campaign=${encodeURIComponent(p.campaign_id)}` : "");
  const sub = p.paused ? "Auto-approval is on hold while this campaign is paused."
    : when.full ? `The first one approves itself on <b style="color:#14120e;">${esc(when.full)}</b>.` : "";
  const body = [
    row(bigNumber(String(n), `${plural(n, "clip", "clips")} waiting on ${esc(camp)}`, sub)),
    row(reviewList(p, now, n), 22),
  ].join("\n");
  const subject = `${n} ${plural(n, "clip is", "clips are")} waiting for your review on ${camp}`;
  const intro = `Creators have submitted ${n} ${plural(n, "clip", "clips")} to ${esc(camp)} that nobody on your team has reviewed yet. ` +
    "Approve the ones you like and reject the rest with a reason the creator will see.";
  const note = (p.paused ? "" : `Anything you have not reviewed is approved automatically ${hours} hours after it was submitted. `) +
    (p.digest ? "This is your daily summary: one email a day while clips are waiting, none when nothing is."
              : `We email you again when ${m + 10} are waiting.`);
  return {
    subject,
    html: layout({
      label: "Review", preheader: `${n} clips are waiting on ${camp}.` + (sub && !p.paused ? ` The first approves itself ${when.full}.` : ""),
      title: `${n} ${plural(n, "clip is", "clips are")} waiting for your review.`, intro, body,
      cta_text: `Review ${n} ${plural(n, "clip", "clips")}`, cta_href: href, note,
      fine: clientFine(camp, c.portal),
      reason: p.digest ? "Sent once a day while clips are waiting for your review." : "Sent because clips are waiting for your review.",
    }),
    text: text(`${n} clips are waiting for your review on ${camp}.`, "", intro, sub, "", `Review now: ${href}`, "",
      ...(p.clips || []).slice(0, 5).map((x) => `- ${x.handle || "A creator"}: auto-approves in ${fmtLeft(x.due, now)} ${safeUrl(x.url)}`),
      "", note, "", `Choose which emails you get: ${c.portal}/profile.html`),
  };
}

function reminder(p: Payload, c: Ctx): Mail {
  const now = c.now ?? Date.now();
  const n = Math.max(1, num(p.count) || (p.clips?.length ?? 1));
  const camp = (campName(p.campaign) || "your campaign"), when = fmtWhen(p.first_due, p.timezone || "Asia/Kolkata");
  const href = `${c.portal}/campaign.html?view=review` + (p.campaign_id ? `&campaign=${encodeURIComponent(p.campaign_id)}` : "");
  const subject = `${n} ${plural(n, "clip", "clips")} on ${camp} ${plural(n, "approves", "approve")} automatically at ${when.time} unless you act`;
  const intro = `${plural(n, "This clip", "These clips")} on ${esc(camp)} ${plural(n, "has", "have")} not been reviewed yet. ` +
    `If you do nothing, ${plural(n, "it is", "the first is")} approved automatically and counts toward your campaign.`;
  const body = [
    row(bigNumber(fmtLeft(p.first_due, now) || "soon", `until the first auto-approval`, when.full ? `<b style="color:#14120e;">${esc(when.full)}</b>` : "")),
    row(reviewList(p, now, n), 22),
  ].join("\n");
  return {
    subject,
    html: layout({
      label: "Review", preheader: `${n} ${plural(n, "clip approves", "clips approve")} automatically at ${when.time} unless you review ${plural(n, "it", "them")}.`,
      title: `${n} ${plural(n, "clip approves", "clips approve")} automatically soon.`, intro, body,
      cta_text: "Review now", cta_href: href, note: "We only send this once per clip.",
      fine: clientFine(camp, c.portal), reason: "Sent because clips are about to be approved automatically.",
    }),
    text: text(subject, "", intro, "", `Review now: ${href}`, "",
      ...(p.clips || []).slice(0, 5).map((x) => `- ${x.handle || "A creator"}: auto-approves in ${fmtLeft(x.due, now)} ${safeUrl(x.url)}`)),
  };
}

/* ---------------- 2. weekly report ---------------- */

function weeklyReport(p: Payload, c: Ctx): Mail {
  const camp = (campName(p.campaign) || "your campaign"), tz = p.timezone || "Asia/Kolkata";
  const wk = fmtWeek(p.week_start, p.week_end, tz);
  const views = num(p.views), vPrev = num(p.views_prev), appr = num(p.approved), aPrev = num(p.approved_prev);
  const cur = p.currency || "USD", spent = num(p.spent), budget = num(p.budget);
  const vDelta = vPrev > 0
    ? (views >= vPrev ? `&#9650; ${Math.round((views / vPrev - 1) * 100)}% on last week` : `&#9660; ${Math.round((1 - views / vPrev) * 100)}% on last week`)
    : views > 0 ? "First views this campaign" : "No new views";
  const aDelta = appr === aPrev ? "Same as last week" : appr > aPrev ? `&#9650; ${appr - aPrev} on last week` : `&#9660; ${aPrev - appr} on last week`;
  const kpi = (v: string, l: string, d: string, side: "l" | "r", tone: "up" | "down" | "flat") => {
    const col = tone === "up" ? "#2f7a52" : tone === "down" ? "#a0521f" : "#8a8378";
    const pad = side === "l" ? "padding:0 6px 12px 0;" : "padding:0 0 12px 6px;";
    return `<td width="50%" style="${pad}vertical-align:top;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f3ec;border:1px solid #e6e1d6;border-radius:12px;"><tr><td style="padding:14px 14px 13px;">` +
      `<div style="font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:#9a9287;">${l}</div>` +
      `<div style="font-family:${SERIF};font-size:26px;line-height:1.15;color:#14120e;margin-top:6px;">${v}</div>` +
      `<div style="font-size:12px;color:${col};margin-top:3px;">${d}</div></td></tr></table></td>`;
  };
  const tone = (a: number, b: number) => (a > b ? "up" : a < b ? "down" : "flat") as "up" | "down" | "flat";
  const live = num(p.live), creators = num(p.creators);
  // Views are tracked while the campaign is active. Once nothing was fetched
  // this week (campaign paused or ended), show the all-time total instead.
  const tracked = p.tracking === undefined || num(p.tracking) > 0 || views > 0;
  const viewsTile = tracked
    ? kpi(compact(views), "Views this week", vDelta, "l", vPrev > 0 ? tone(views, vPrev) : "flat")
    : kpi(compact(num(p.views_total)), "Total views", "No views tracked this week", "l", "flat");
  const grid = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>${viewsTile}${kpi(String(appr), "Clips approved", aDelta, "r", tone(appr, aPrev))}</tr>
    <tr>${kpi(String(live), "Clips live", `${creators} ${plural(creators, "creator", "creators")} posting`, "l", "flat")}${kpi(esc(money(spent, cur)), "Spent so far", budget > 0 ? `of ${esc(money(budget, cur))} budget` : "&nbsp;", "r", "flat")}</tr>
  </table>`;
  const small = facts([["Waiting for your review", String(num(p.waiting))], ["Rejected this week", String(num(p.rejected))], ["Auto-approved (no review)", String(num(p.auto))]]);
  const numerals = ["I", "II", "III"];
  const tops = (p.top || []).slice(0, 3).map((t, i): [string, string, string] => [
    `<b style="font-family:${SERIF};font-weight:400;color:#8a6224;">${numerals[i]}</b>&nbsp;&nbsp;<b style="font-weight:600;">${esc(t.handle || "A creator")}</b>`,
    `${num(t.gain) > 0 ? `+${compact(num(t.gain))} views this week &middot; ` : ""}${compact(num(t.views))} total &middot; ${compact(num(t.likes))} likes`,
    watch(t.url),
  ]);
  const body = [
    row(grid, 22), row(panel(small, "6px 18px"), 0),
    tops.length ? row(sectionLabel((p.top || []).some((t) => num(t.gain) > 0) ? "Top clips this week" : "Top clips so far") + listRows(tops), 24) : "",
  ].filter(Boolean).join("\n");
  const href = `${c.portal}/campaign.html?view=overview` + (p.campaign_id ? `&campaign=${encodeURIComponent(p.campaign_id)}` : "");
  const viewsLine = tracked ? `${compact(views)} views` : `${compact(num(p.views_total))} total views`;
  const pre = `${camp}, ${wk.short}: ${viewsLine}, ${appr} ${plural(appr, "clip", "clips")} approved, ${num(p.waiting)} waiting for review.`;
  return {
    subject: `Your week on ${camp}: ${viewsLine}, ${appr} ${plural(appr, "clip", "clips")} approved`,
    html: layout({
      label: "Weekly report", preheader: pre, title: `Your week on ${esc(camp)}.`,
      intro: `${esc(wk.long)}. The same numbers you see on your dashboard.`, body,
      cta_text: "Open your dashboard", cta_href: href,
      note: "Views refresh at least once a day, so your dashboard may already be ahead of this email.",
      fine: clientFine(camp, c.portal), reason: "Sent every Monday while your campaign is running.",
    }),
    text: text(`Your week on ${camp} (${wk.long})`, "",
      tracked ? `Views this week: ${compact(views)} (last week ${compact(vPrev)})` : `Total views: ${compact(num(p.views_total))} (no views tracked this week)`, `Clips approved: ${appr} (last week ${aPrev})`,
      `Clips live: ${live} from ${creators} creators`, `Spent so far: ${money(spent, cur)}${budget > 0 ? ` of ${money(budget, cur)}` : ""}`,
      `Waiting for review: ${num(p.waiting)} · Rejected: ${num(p.rejected)} · Auto-approved: ${num(p.auto)}`, "",
      ...(p.top || []).slice(0, 3).map((t, i) => `${i + 1}. ${t.handle || "A creator"}: ${compact(num(t.views))} views ${safeUrl(t.url)}`),
      "", `Open your dashboard: ${href}`),
  };
}

/* ---------------- 3. clip approved ---------------- */

function clipApproved(p: Payload, c: Ctx): Mail {
  const camp = (campName(p.campaign) || "the campaign"), when = fmtWhen(p.decided_at, p.timezone || "Asia/Kolkata");
  const u = safeUrl(p.url);
  const pairs: [string, string][] = [["Campaign", esc(camp)]];
  if (p.handle) pairs.push(["Account", esc(p.handle)]);
  if (u) pairs.push(["Clip", `<a href="${esc(u)}" style="color:#8a6224;text-decoration:none;font-weight:600;">${clipKind(p.platform)} &#8599;</a>`]);
  if (when.full) pairs.push(["Approved", esc(when.full)]);
  const intro = `${esc(camp)} approved your clip. It now counts toward the campaign.`;
  const note = "Keep the post public and up. Views are checked twice a day at first, then daily while the campaign runs. A deleted or private post stops counting.";
  return {
    subject: `Approved: your clip for ${camp}`,
    html: layout({
      label: "Creators", preheader: `${camp} approved your clip.`, title: "Your clip is approved.", intro,
      body: row(panel(facts(pairs), "6px 18px")), cta_text: "See it in your dashboard", cta_href: c.clipper, note,
      fine: CREATOR_FINE, reason: "Sent because one of your clips was approved.",
    }),
    text: text("Your clip is approved.", "", intro, u && `Clip: ${u}`, "", note, "", `Your dashboard: ${c.clipper}`),
  };
}

/* ---------------- 3b. several clips approved: the daily summary ---------------- */

function clipsApproved(p: Payload, c: Ctx): Mail {
  const list = ((p.clips as unknown as Approval[]) || []);
  const n = Math.max(list.length, num(p.count));
  const camp = p.campaign ? campName(p.campaign) : "";
  const tz = p.timezone || "Asia/Kolkata";
  const rows = list.slice(0, 10).map((x): [string, string, string] => {
    const when = fmtWhen(x.decided_at, tz);
    return [
      `<b style="font-weight:600;">${esc(campName(x.campaign) || "Clip")}</b>${x.handle ? `<span style="color:#9a9287;"> &middot; ${esc(x.handle)}</span>` : ""}`,
      `${esc(clipKind(x.platform))}${when.full ? ` &middot; approved ${esc(when.full)}` : ""}`,
      watch(x.url),
    ];
  });
  const more = n - rows.length;
  const intro = (camp ? `${n} of your clips for ${esc(camp)} were approved.` : `${n} of your clips were approved.`) +
    " They now count toward their campaigns.";
  const note = "Keep the posts public and up. Views are checked twice a day at first, then daily while the campaign runs. A deleted or private post stops counting.";
  const body = row(sectionLabel(more > 0 ? "Latest approved" : "Approved") + listRows(rows) +
    (more > 0 ? `<div style="font-size:12.5px;color:#8a8378;padding-top:10px;border-top:1px solid #eeeae1;">and ${more} more in your dashboard</div>` : ""), 22);
  return {
    subject: camp ? `Approved: ${n} of your clips for ${camp}` : `Approved: ${n} of your clips`,
    html: layout({
      label: "Creators", preheader: `${n} clips approved.`, title: `${n} clips approved.`, intro, body,
      cta_text: "See them in your dashboard", cta_href: c.clipper, note,
      fine: CREATOR_FINE, reason: "Sent once 5 of your clips are approved, so you get one email instead of five.",
    }),
    text: text(`${n} clips approved.`, "", intro, "",
      ...list.slice(0, 10).map((x) => `- ${campName(x.campaign) || "Clip"}${x.handle ? ` (${x.handle})` : ""}: ${safeUrl(x.url)}`),
      ...(more > 0 ? [`and ${more} more in your dashboard`] : []),
      "", note, "", `Your dashboard: ${c.clipper}`),
  };
}

/* ---------------- 4. clip rejected, redo in 24 hours ---------------- */

function clipRejected(p: Payload, c: Ctx): Mail {
  const camp = (campName(p.campaign) || "the campaign"), tz = p.timezone || "Asia/Kolkata";
  const who = p.by_brand ? esc(camp) : "the Clipency team";
  // The flag form joins "Low quality" and the note with a long dash; show "Low quality: note" instead
  const reasonRaw = p.reason ? String(p.reason).split(String.fromCharCode(0x2014)).map((x) => x.trim()).filter(Boolean).join(": ") : "";
  const reasonText = reasonRaw ? esc(reasonRaw) : "No reason was given. Open the clip in your dashboard to ask.";
  const deadline = fmtWhen(p.deadline, tz);
  // Which clip. The email used to say only "your clip": a creator with
  // several clips on the campaign could not tell which one to redo. Now the
  // account, the post itself (as a line and as a button) and when it was
  // turned down come first, before the reason.
  const u = safeUrl(p.url);
  const when = fmtWhen(p.decided_at, tz);
  const kindRaw = clipKind(p.platform), kind = kindRaw === "Your clip" ? "clip" : kindRaw;
  const pairs: [string, string][] = [["Campaign", esc(camp)]];
  if (p.handle) pairs.push(["Account", esc(p.handle)]);
  if (u) pairs.push(["Clip", `<a href="${esc(u)}" style="color:#8a6224;text-decoration:none;font-weight:600;">${esc(kindRaw)} &#8599;</a>`]);
  if (when.full) pairs.push(["Rejected", esc(when.full)]);
  const which = panel(facts(pairs), "6px 18px");
  const clipBtn = u
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
      `<td align="center" style="border:1px solid #d9d2c4;border-radius:12px;background:#ffffff;">` +
      `<a href="${esc(u)}" style="display:block;padding:13px 22px;color:#14120e;font-size:14px;font-weight:600;text-decoration:none;">Open the rejected ${esc(kind)} &#8599;</a></td></tr></table>`
    : "";
  const reasonBox = panel(
    `<div style="font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:#a0521f;margin-bottom:6px;">Reason from ${who}</div>` +
    `<div style="font-size:15px;line-height:1.55;color:#14120e;">${reasonText}</div>`, "16px 18px", "#fbf1ec", "#efd9cc");
  // A live countdown is impossible in email (no JavaScript). This image is
  // drawn by the email-countdown function each time the email is opened and
  // ticks for a minute; the deadline in words is always under it.
  const img = p.deadline
    ? `<img src="${esc(c.countdown)}?until=${encodeURIComponent(p.deadline)}" width="280" height="60" alt="Time left to resubmit" style="display:block;margin:0 auto;width:280px;height:60px;border:0;outline:none;color:#5a554c;font-size:13px;">` +
      // labels sit under the three digit pairs drawn in the image
      `<table role="presentation" width="280" cellpadding="0" cellspacing="0" border="0" align="center" style="width:280px;margin:0 auto;"><tr>` +
      `<td width="33"></td>` + ["Hours", "Min", "Sec"].map((l, i) => (i ? `<td width="17"></td>` : "") +
        `<td align="center" width="60" style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#9a9287;padding-top:2px;">${l}</td>`).join("") +
      `<td width="33"></td></tr></table>`
    : "";
  const timer = panel(img +
    `<div style="text-align:center;font-size:13px;line-height:1.55;color:#5a554c;margin-top:12px;">` +
    (deadline.full ? `Resubmit before <b style="color:#14120e;">${esc(deadline.full)}</b>` : "Resubmit within 24 hours") + `</div>`, "20px 12px 18px");
  const body = [
    row(which, 22), clipBtn && row(clipBtn, 12), row(reasonBox, 22), row(timer, 14),
    row(sectionLabel("How to fix it") + steps([
      ["Open the clip and read the reason", p.by_brand ? "The reason comes straight from the brand." : "The reason comes from the team that reviewed it."],
      ["Post a fixed version", "A new post, so it has a new link."],
      ["Submit the new link", "Before the timer runs out."],
    ]), 22),
  ].filter(Boolean).join("\n");
  const acct = p.handle ? ` for ${esc(p.handle)}` : "";
  const intro = (p.by_brand ? `${esc(camp)} did not approve your ${esc(kind)}${acct}.` : `Your ${esc(kind)}${acct} for ${esc(camp)} was not approved.`) +
    " You have 24 hours to fix it and submit it again.";
  return {
    subject: `Redo needed: your clip for ${camp}`,
    html: layout({
      label: "Creators", preheader: `Your clip for ${camp} was not approved. You have 24 hours to fix it and resubmit.`,
      title: "Your clip needs a redo.", intro, body, cta_text: "Fix and resubmit", cta_href: c.clipper,
      cta_note: "Think this is a mistake? Appeal from the clip in your dashboard.",
      fine: CREATOR_FINE, reason: "Sent because one of your clips was not approved.",
    }),
    text: text("Your clip needs a redo.", "", intro, "", u && `The rejected ${kind}: ${u}`, when.full && `Rejected ${when.full}.`, "",
      `Reason from ${p.by_brand ? camp : "the Clipency team"}: ${reasonRaw || "none given"}`,
      deadline.full && `Resubmit before ${deadline.full}.`, "", `Fix and resubmit: ${c.clipper}`),
  };
}

/* ---------------- 5. approved into a private campaign ---------------- */

function privateApproved(p: Payload, c: Ctx): Mail {
  const camp = (campName(p.campaign) || "a private campaign");
  const pairs: [string, string][] = [["Campaign", esc(camp)]];
  if (p.handle) pairs.push(["Approved account", esc(p.handle)]);
  if (p.platform) pairs.push(["Platform", esc(formatName(p.platform))]);
  const acct = p.handle ? esc(p.handle) : "your approved account";
  const body = [
    row(panel(facts(pairs), "6px 18px"), 22),
    row(sectionLabel("How to start") + steps([
      ["Read the brief", "What to show, what to avoid, and the hooks that work."],
      [`Post from ${acct}`, "Clips from any other account are refused."],
      ["Submit each link", "The brand reviews it within 48 hours."],
    ]), 22),
  ].join("\n");
  const intro = `Your application to the private ${esc(camp)} campaign was approved. Only approved creators can see it and submit to it.`;
  const note = `Your spot is for ${acct} only. To add another account, apply again from the campaign page.`;
  return {
    subject: `You're in: ${camp}`,
    html: layout({
      label: "Creators", preheader: `You're in. Your application to ${camp} was approved.`, title: `You're in: ${esc(camp)}.`,
      intro, body, cta_text: "Open the campaign brief", cta_href: c.clipper, note,
      fine: CREATOR_FINE, reason: "Sent because your application to a private campaign was approved.",
    }),
    text: text(`You're in: ${camp}.`, "", intro, "", note, "", `Open the campaign: ${c.clipper}`),
  };
}

/* ---------------- entry ---------------- */

export const KINDS = ["review_digest", "review_milestone", "reminder", "weekly_report", "clip_approved", "clips_approved", "clip_rejected", "private_approved"] as const;

export function render(kind: string, p: Payload, c: Ctx): Mail {
  switch (kind) {
    case "review_digest": return reviewMilestone({ ...p, digest: true }, c);
    case "review_milestone": case "new_clips": return reviewMilestone(p, c);
    case "reminder": return reminder(p, c);
    case "weekly_report": return weeklyReport(p, c);
    case "clip_approved": return clipApproved(p, c);
    case "clips_approved": return clipsApproved(p, c);
    case "clip_rejected": return clipRejected(p, c);
    case "private_approved": return privateApproved(p, c);
    default: throw new Error(`Unknown email kind: ${kind}`);
  }
}

/** Sample payloads for the staff test email: one of each kind. */
export function samples(now = Date.now()): Record<string, Payload> {
  const iso = (ms: number) => new Date(now + ms).toISOString();
  const H = 3600e3;
  const reel = "https://www.instagram.com/";
  const clips = [2.2, 9, 17.7, 27, 33].map((h, i) => ({ handle: ["@creator.one", "@creator.two", "@creator.three", "@creator.four", "@creator.one"][i], platform: "instagram", url: reel, due: iso(h * H) }));
  // last full Monday to Sunday week, in IST (UTC+5:30)
  const ist = new Date(now + 5.5 * H); ist.setUTCHours(0, 0, 0, 0); ist.setUTCDate(ist.getUTCDate() - ((ist.getUTCDay() + 6) % 7) - 7);
  const mon = new Date(ist.getTime() - 5.5 * H);
  return {
    review_digest: { campaign: "Sample campaign", count: 24, first_due: clips[0].due, timezone: "Asia/Kolkata", window_hours: 48, clips, digest: true },
    review_milestone: { campaign: "Sample campaign", count: 20, milestone: 20, first_due: clips[0].due, timezone: "Asia/Kolkata", window_hours: 48, clips },
    reminder: { campaign: "Sample campaign", count: 2, first_due: iso(5.5 * H), timezone: "Asia/Kolkata", clips: [{ ...clips[0], due: iso(5.5 * H) }, { ...clips[1], due: iso(5.9 * H) }] },
    weekly_report: {
      campaign: "Sample campaign", timezone: "Asia/Kolkata", week_start: mon.toISOString(), week_end: new Date(mon.getTime() + 7 * 24 * H - 1000).toISOString(),
      views: 184200, views_prev: 139500, approved: 14, approved_prev: 9, live: 38, creators: 9, waiting: 3, rejected: 2, auto: 1,
      currency: "INR", spent: 36000, budget: 100000,
      top: [{ handle: "@creator.one", url: reel, views: 41300, likes: 2100, gain: 30100 }, { handle: "@creator.two", url: reel, views: 28900, likes: 1400, gain: 21000 }, { handle: "@creator.three", url: reel, views: 17000, likes: 912, gain: 9800 }],
    },
    clip_approved: { campaign: "Sample campaign", handle: "@creator.one", platform: "instagram", url: reel, decided_at: iso(0), timezone: "Asia/Kolkata" },
    clips_approved: { count: 3, timezone: "Asia/Kolkata", digest: true, campaign: "Sample campaign",
      clips: [1, 2, 3].map((i) => ({ campaign: "Sample campaign", handle: "@creator.one", platform: "instagram", url: reel, decided_at: iso(-i * H) })) as unknown as Clip[] },
    clip_rejected: { campaign: "Sample campaign", handle: "@creator.one", platform: "instagram", url: reel, decided_at: iso(0), timezone: "Asia/Kolkata", reason: "Wrong product or link: the video shows the old pack.", by_brand: true, deadline: iso(24 * H) },
    private_approved: { campaign: "Sample campaign", handle: "@creator.one", platform: "instagram", timezone: "Asia/Kolkata" },
  };
}
