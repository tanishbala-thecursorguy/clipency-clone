// creator-reminders
// Content-calendar emails to creators (clipency-db/057_content_calendar.sql).
//
//   POST { mode: "run" }          service role only (pg_cron via cal_kick, every 10 min)
//   POST { mode: "test", to }     Clipency staff only: every email type, filled with sample data, to `to`
//
// What is due is decided in SQL (cx_cal_due / cal_claim): an intro with the dates,
// a 10 AM reminder (reaction creators), a 7 PM reminder, and one "pause now" email
// once the target is reached. Reminders only go while that day's video is still
// missing, and each email is claimed once, so a rerun never sends it twice.
//
// Provider key: RESEND_API_KEY secret, or Vault via cx_email_provider_key (same as promo-emails).

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const FROM = "Clipency <hello@clipency.in>";
const REPLY_TO = "hello@clipency.in";
const DASH = "https://www.clipency.in/client/clipper#calendar";
const LOGO = "https://kszlfvsplkkmsgxqnakj.supabase.co/storage/v1/object/public/assets/clipency-logo-chip.png";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

type Day = { day: string; videos: number; posted: number; slots: string[] };
type State = { style: "talking" | "reaction"; per_day: number; target: number; done: number; remaining: number; today_posted: number; today_planned: number; schedule: Day[] };
type Claim = { send_id: number; kind: "intro" | "morning" | "evening" | "pause"; email: string; first_name: string; label: string; campaign: string; state: State };

async function providerKey(): Promise<string> {
  const env = Deno.env.get("RESEND_API_KEY");
  if (env) return env;
  const { data } = await admin.rpc("cx_email_provider_key");
  return typeof data === "string" ? data : "";
}
async function isStaff(token: string): Promise<boolean> {
  if (!token) return false;
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await asCaller.rpc("cx_is_staff");
  return !error && data === true;
}

const dayName = (d: string) =>
  new Date(d + "T12:00:00+05:30").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const brand = (c: string) => c.replace(/\s*\{.*?\}\s*/g, " ").trim() || c;

function rule(s: State) {
  return s.style === "reaction"
    ? "Post <b>2 reaction videos a day</b>: one between <b>10 AM and 12 PM</b>, and one between <b>7 PM and 9 PM</b> (India time)."
    : "Post <b>1 talking-head video a day</b>, <b>before 9 PM</b> (India time).";
}
function scheduleTable(s: State) {
  const rows = s.schedule.slice(0, 14).map((d) =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #ebe4d7;font-weight:600;color:#14120e;white-space:nowrap">${esc(dayName(d.day))}</td>` +
    `<td style="padding:8px 12px;border-bottom:1px solid #ebe4d7;color:#5b554c">${d.videos} video${d.videos === 1 ? "" : "s"}</td>` +
    `<td style="padding:8px 12px;border-bottom:1px solid #ebe4d7;color:#5b554c">${d.slots.map(esc).join(" &amp; ")}</td></tr>`).join("");
  const more = s.schedule.length > 14 ? `<p style="font-size:12px;color:#8a8378;margin:8px 0 0">…and ${s.schedule.length - 14} more days, on your dashboard.</p>` : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13.5px;margin:6px 0 0">${rows}</table>${more}`;
}
function shell(title: string, body: string, cta = "Open my content calendar") {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f6f3ec;font-family:Inter,Helvetica,Arial,sans-serif;color:#14120e;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f3ec;"><tr><td align="center" style="padding:32px 14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#faf9f6;border:1px solid #e6dfd2;border-radius:18px;overflow:hidden;">
<tr><td style="height:3px;background:#c8a170;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td align="center" style="padding:28px 28px 4px;"><img src="${LOGO}" width="120" alt="Clipency" style="display:block;border:0;height:auto;"></td></tr>
<tr><td align="center" style="padding:18px 30px 0;"><div style="font-family:Georgia,'Times New Roman',serif;font-size:27px;line-height:1.25;color:#14120e;">${title}</div></td></tr>
<tr><td style="padding:16px 32px 0;font-size:14.5px;line-height:1.65;color:#3d3830;">${body}</td></tr>
<tr><td align="center" style="padding:24px 28px 8px;"><a href="${DASH}" style="display:inline-block;background:#14120e;color:#f3efe7;text-decoration:none;font-size:14px;font-weight:600;padding:13px 28px;border-radius:999px;">${cta}</a></td></tr>
<tr><td align="center" style="padding:14px 34px 28px;font-size:12px;line-height:1.6;color:#8a8378;">After posting, submit the link on your Clipency dashboard the same day so it counts.<br>Questions? Reply to this email.</td></tr>
</table><div style="padding:14px 8px 0;font-size:11px;color:#a39b8e;">© 2026 Clipency</div></td></tr></table></body></html>`;
}
function progress(s: State) {
  return `<p style="margin:14px 0 0">Progress: <b>${s.done} of ${s.target}</b> videos done, <b>${s.remaining}</b> to go.</p>`;
}

function build(c: Claim) {
  const s = c.state, hi = `Hi ${esc(c.first_name || c.label)},`, camp = esc(brand(c.campaign));
  if (c.kind === "intro") {
    return {
      subject: `Your ${brand(c.campaign)} posting calendar starts today`,
      html: shell("Your posting calendar", `<p style="margin:0">${hi}</p>
<p style="margin:12px 0 0">Your content calendar for <b>${camp}</b> is ready. ${rule(s)}</p>${progress(s)}
<p style="margin:16px 0 4px;font-weight:600;color:#14120e">Your posting days</p>${scheduleTable(s)}
<p style="margin:16px 0 0">We'll email you a reminder on each posting day${s.style === "reaction" ? " at 10 AM and 7 PM" : " at 7 PM"}, and tell you when you've hit ${s.target} so you can pause.</p>`),
    };
  }
  if (c.kind === "morning") {
    return {
      subject: `Morning video due by 12 PM: ${brand(c.campaign)}`,
      html: shell("Morning video due by 12 PM", `<p style="margin:0">${hi}</p>
<p style="margin:12px 0 0">Time for your first <b>${camp}</b> reaction video today. Please post it <b>between 10 AM and 12 PM</b> (India time), then submit the link on your dashboard. Your second one is due between 7 PM and 9 PM.</p>${progress(s)}`, "Submit my video"),
    };
  }
  if (c.kind === "evening") {
    const left = Math.max(1, s.today_planned - s.today_posted);
    const what = s.style === "reaction"
      ? (left >= 2 ? "both of today's reaction videos" : "your evening reaction video")
      : "today's talking-head video";
    return {
      subject: `Today's video is due by 9 PM: ${brand(c.campaign)}`,
      html: shell("Today's video is due by 9 PM", `<p style="margin:0">${hi}</p>
<p style="margin:12px 0 0">Reminder: please post ${what} for <b>${camp}</b> <b>before 9 PM</b> (India time), then submit the link on your dashboard.</p>${progress(s)}`, "Submit my video"),
    };
  }
  return {
    subject: `You've finished ${brand(c.campaign)}: pause for now`,
    html: shell(`You've hit ${s.target}. Pause for now.`, `<p style="margin:0">${hi}</p>
<p style="margin:12px 0 0">You've completed all <b>${s.target} videos</b> for <b>${camp}</b>. Thank you! Please <b>pause posting for this campaign</b> for now; we'll message you if more are needed.</p>
<p style="margin:12px 0 0">Make sure every video's link is submitted on your dashboard so it's counted and paid.</p>`, "Open my dashboard"),
  };
}

async function send(key: string, to: string, m: { subject: string; html: string }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject: m.subject, html: m.html }),
    signal: AbortSignal.timeout(20_000),
  });
  const out = await res.json().catch(() => ({})) as { id?: string; message?: string };
  return res.ok ? { ok: true, id: out.id ?? null, error: null } : { ok: false, id: null, error: `Resend ${res.status}: ${JSON.stringify(out).slice(0, 300)}` };
}

function sample(style: "talking" | "reaction"): State {
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const day = (i: number) => new Date(new Date(today + "T12:00:00Z").getTime() + i * 864e5).toISOString().slice(0, 10);
  return style === "reaction"
    ? { style, per_day: 2, target: 15, done: 6, remaining: 9, today_posted: 0, today_planned: 2,
        schedule: [0, 1, 2, 3].map((i) => ({ day: day(i), videos: 2, posted: 0, slots: ["10 AM – 12 PM", "7 PM – 9 PM"] })).concat([{ day: day(4), videos: 1, posted: 0, slots: ["7 PM – 9 PM"] }]) }
    : { style, per_day: 1, target: 8, done: 5, remaining: 3, today_posted: 0, today_planned: 1,
        schedule: [0, 1, 2].map((i) => ({ day: day(i), videos: 1, posted: 0, slots: ["Before 9 PM"] })) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const isService = !!SERVICE_KEY && token === SERVICE_KEY;
  let body: { mode?: string; to?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const key = await providerKey();
  if (!key) return json({ error: "No email provider configured." }, 409);

  if (body.mode === "test") {
    if (!isService && !(await isStaff(token))) return json({ error: "Staff only." }, 403);
    const to = String(body.to || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ error: "Give a valid 'to' address." }, 400);
    const base = { email: to, first_name: "Pawan", label: "pawan.heic", campaign: "Octupie {UGC Campaign}", send_id: 0 };
    const tests: Claim[] = [
      { ...base, kind: "intro", state: sample("talking") },
      { ...base, kind: "evening", state: sample("talking") },
      { ...base, first_name: "Narayani", label: "narayani.talks", kind: "intro", state: sample("reaction") },
      { ...base, first_name: "Narayani", label: "narayani.talks", kind: "morning", state: sample("reaction") },
      { ...base, first_name: "Narayani", label: "narayani.talks", kind: "pause", state: { ...sample("reaction"), done: 15, remaining: 0, schedule: [] } },
    ];
    const results = [];
    for (const t of tests) {
      const m = build(t);
      results.push({ kind: t.kind, style: t.state.style, ...(await send(key, to, { ...m, subject: "[Test] " + m.subject })) });
      await new Promise((ok) => setTimeout(ok, 600));
    }
    return json({ mode: "test", results });
  }

  if (!isService) return json({ error: "Sending runs on the schedule only." }, 403);
  const { data, error } = await admin.rpc("cal_claim");
  if (error) return json({ error: error.message }, 500);
  const rows = (data ?? []) as Claim[];
  let sent = 0, failed = 0;
  for (const c of rows) {
    const r = c.email ? await send(key, c.email, build(c)) : { ok: false, id: null, error: "no email on the account" };
    await admin.rpc("cal_mark", { p_id: c.send_id, p_ok: r.ok, p_provider_id: r.id, p_error: r.error });
    r.ok ? sent++ : failed++;
    await new Promise((ok) => setTimeout(ok, 600));  /* Resend allows ~2 requests a second */
  }
  return json({ mode: "run", sent, failed });
});
