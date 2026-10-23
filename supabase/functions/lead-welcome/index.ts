// lead-welcome
// The first reply to every new website inquiry (public.leads, via submit_landing_lead).
// Booking form (raw_payload.booking set): "your call is booked" with the time and joining link,
// read from Calendly when CALENDLY_TOKEN is set (otherwise it points to Calendly's invite).
// Older inquiry form (no booking): "thanks, here's the link to book".
//   1. an email from Tanish (tanish@clipency.in) via Resend;
//   2. a WhatsApp message from Clipency's WhatsApp Business number, via the official
//      WhatsApp Cloud API, using the approved template (only if the person gave a number,
//      ticked "message me on WhatsApp", and asked within the last 48 hours).
//
//   POST { mode: "send" }   service role only (pg_cron cx_lead_welcome, every 5 minutes)
//
// Which leads are due is decided in SQL (040). Nothing is sent until BOOKING_URL is set.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   BOOKING_URL                 optional: overrides the built-in link (calendly.com/tanish-clipency/30min)
//   LEAD_EMAIL_FROM             optional, default "Tanish from Clipency <tanish@clipency.in>"
//   RESEND_API_KEY              optional: falls back to Vault resend_api_key (same as other emails)
//   WHATSAPP_TOKEN              WhatsApp Cloud API access token (permanent system-user token)
//   WHATSAPP_PHONE_NUMBER_ID    the WhatsApp Business phone number id from Meta
//   WHATSAPP_TEMPLATE           optional, default "clipency_welcome" ({{1}} = first name, {{2}} = link)
//   WHATSAPP_TEMPLATE_LANG      optional, default "en"
//   WHATSAPP_BOOKED_TEMPLATE    optional, default "clipency_booked" ({{1}} = first name, {{2}} = booked time)
//   CALENDLY_TOKEN              optional: Calendly personal access token, to put the booked time in the messages
// Without the WhatsApp secrets, WhatsApp is skipped and only the email goes out.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOOKING_URL = (Deno.env.get("BOOKING_URL") || "https://calendly.com/tanish-clipency/30min").trim();
const FROM = Deno.env.get("LEAD_EMAIL_FROM") ?? "Tanish from Clipency <tanish@clipency.in>";
const REPLY_TO = "tanish@clipency.in";
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const WA_TEMPLATE = Deno.env.get("WHATSAPP_TEMPLATE") ?? "clipency_welcome";
const WA_LANG = Deno.env.get("WHATSAPP_TEMPLATE_LANG") ?? "en";
const WA_BOOKED = Deno.env.get("WHATSAPP_BOOKED_TEMPLATE") ?? "clipency_booked";
const CAL_TOKEN = Deno.env.get("CALENDLY_TOKEN") ?? "";
const LOGO = "https://kszlfvsplkkmsgxqnakj.supabase.co/storage/v1/object/public/assets/clipency-logo-chip.png";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

type Lead = { lead_id: string; name: string | null; email: string; phone: string | null; company: string | null;
              whatsapp_ok: boolean; email_status: string; wa_status: string; wa_window: boolean;
              booking: { event_uri?: string; invitee_uri?: string } | null };
type Slot = { when: string; join: string | null; reschedule: string | null; cancel: string | null };

// the booked time, in the invitee's own time zone, read from Calendly (needs CALENDLY_TOKEN)
async function bookedSlot(b: Lead["booking"]): Promise<Slot | null> {
  if (!CAL_TOKEN || !b?.invitee_uri || !b?.event_uri) return null;
  const okUri = (u: string) => /^https:\/\/api\.calendly\.com\//.test(u);
  if (!okUri(b.invitee_uri) || !okUri(b.event_uri)) return null;
  const get = async (u: string) => {
    const r = await fetch(u, { headers: { Authorization: `Bearer ${CAL_TOKEN}` }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`Calendly ${r.status}`);
    return (await r.json()).resource;
  };
  const [inv, ev] = await Promise.all([get(b.invitee_uri), get(b.event_uri)]);
  const tz = inv?.timezone || "Asia/Kolkata";
  const start = new Date(ev.start_time);
  const when = new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" }).format(start);
  return { when, join: ev?.location?.join_url ?? null, reschedule: inv?.reschedule_url ?? null, cancel: inv?.cancel_url ?? null };
}

const firstName = (n: string | null) => (String(n ?? "").trim().split(/\s+/)[0] || "there").slice(0, 40);

// "+91 98765 43210" / "098765 43210" / "9876543210" -> "919876543210" (WhatsApp wants digits with country code)
function waNumber(raw: string | null): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "91" + d;   // a bare 10-digit number is taken as Indian
  return d.length >= 11 && d.length <= 15 ? d : null;
}

async function resendKey(): Promise<string> {
  const env = Deno.env.get("RESEND_API_KEY");
  if (env) return env;
  const { data } = await admin.rpc("cx_email_provider_key");
  return typeof data === "string" ? data : "";
}

function bookedEmail(l: Lead, slot: Slot | null) {
  const name = firstName(l.name);
  const timeLine = slot ? `<b>${esc(slot.when)}</b>` : "the time you picked (it's in the calendar invite Calendly just sent you)";
  const btn = (href: string, label: string) => `<a href="${esc(href)}" style="display:inline-block;background:#14120e;color:#f3efe7;text-decoration:none;font-size:14px;font-weight:600;padding:13px 26px;border-radius:999px;">${label}</a>`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f6f3ec;font-family:Inter,Helvetica,Arial,sans-serif;color:#14120e;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f3ec;"><tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#faf9f6;border:1px solid #e6dfd2;border-radius:18px;overflow:hidden;">
<tr><td style="height:3px;background:#c8a170;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:30px 36px 6px;"><img src="${LOGO}" width="120" alt="Clipency" style="display:block;border:0;height:auto;"></td></tr>
<tr><td style="padding:18px 36px 0;font-size:15px;line-height:1.7;color:#2b2722;">
<p style="margin:0 0 14px;">Hi ${esc(name)},</p>
<p style="margin:0 0 14px;">Thank you for booking a call. I'm Tanish, co-founder of Clipency, and I'll see you on ${timeLine}.</p>
<p style="margin:0 0 14px;">Come with what you're launching and who it's for, and we'll map out how to take it to market.</p>
</td></tr>
${slot?.join ? `<tr><td style="padding:6px 36px 4px;">${btn(slot.join, "Join the call")}</td></tr>` : ""}
${slot?.reschedule ? `<tr><td style="padding:12px 36px 0;font-size:12.5px;color:#8a8378;">Need another time? <a href="${esc(slot.reschedule)}" style="color:#8a6224;">Reschedule</a>${slot.cancel ? ` · <a href="${esc(slot.cancel)}" style="color:#8a6224;">Cancel</a>` : ""}</td></tr>` : ""}
<tr><td style="padding:22px 36px 30px;font-size:15px;line-height:1.6;color:#2b2722;">Talk soon,<br><b>Tanish</b><br><span style="color:#8a8378;font-size:13px;">Co-founder, Clipency · <a href="https://www.clipency.in" style="color:#8a6224;text-decoration:none;">clipency.in</a></span></td></tr>
</table></td></tr></table></body></html>`;
  const text = `Hi ${name},\n\nThank you for booking a call. I'm Tanish, co-founder of Clipency, and I'll see you on ${slot ? slot.when : "the time you picked (it's in the calendar invite Calendly sent you)"}.\n${slot?.join ? `\nJoin: ${slot.join}\n` : ""}${slot?.reschedule ? `Reschedule: ${slot.reschedule}\n` : ""}\nTalk soon,\nTanish\nCo-founder, Clipency · clipency.in`;
  return { html, text, subject: slot ? `Your call with Clipency: ${slot.when}` : "Your call with Clipency is booked" };
}

function emailBody(l: Lead) {
  const name = firstName(l.name), co = (l.company ?? "").trim();
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f6f3ec;font-family:Inter,Helvetica,Arial,sans-serif;color:#14120e;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f3ec;"><tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#faf9f6;border:1px solid #e6dfd2;border-radius:18px;overflow:hidden;">
<tr><td style="height:3px;background:#c8a170;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:30px 36px 6px;"><img src="${LOGO}" width="120" alt="Clipency" style="display:block;border:0;height:auto;"></td></tr>
<tr><td style="padding:18px 36px 0;font-size:15px;line-height:1.7;color:#2b2722;">
<p style="margin:0 0 14px;">Hi ${esc(name)},</p>
<p style="margin:0 0 14px;">Thank you for your inquiry. I'm Tanish, co-founder of Clipency.</p>
<p style="margin:0 0 14px;">I'd love to hear what you're launching${co ? ` at ${esc(co)}` : ""} and how we can help. Let's have a call and discuss further. Pick a time that works for you:</p>
</td></tr>
<tr><td style="padding:6px 36px 4px;"><a href="${esc(BOOKING_URL)}" style="display:inline-block;background:#14120e;color:#f3efe7;text-decoration:none;font-size:14px;font-weight:600;padding:13px 26px;border-radius:999px;">Book a call</a></td></tr>
<tr><td style="padding:10px 36px 0;font-size:12px;color:#8a8378;">Or open this link: <a href="${esc(BOOKING_URL)}" style="color:#8a6224;word-break:break-all;">${esc(BOOKING_URL)}</a></td></tr>
<tr><td style="padding:22px 36px 30px;font-size:15px;line-height:1.6;color:#2b2722;">Talk soon,<br><b>Tanish</b><br><span style="color:#8a8378;font-size:13px;">Co-founder, Clipency · <a href="https://www.clipency.in" style="color:#8a6224;text-decoration:none;">clipency.in</a></span></td></tr>
</table></td></tr></table></body></html>`;
  const text = `Hi ${name},\n\nThank you for your inquiry. I'm Tanish, co-founder of Clipency.\n\nI'd love to hear what you're launching${co ? ` at ${co}` : ""} and how we can help. Let's have a call and discuss further. Pick a time that works for you:\n${BOOKING_URL}\n\nTalk soon,\nTanish\nCo-founder, Clipency · clipency.in`;
  return { html, text };
}

async function sendEmail(key: string, l: Lead, slot: Slot | null) {
  const m = l.booking ? bookedEmail(l, slot) : { ...emailBody(l), subject: "Thanks for reaching out to Clipency" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `cx-lead-${l.lead_id}` },
    body: JSON.stringify({ from: FROM, to: [l.email], reply_to: REPLY_TO, subject: m.subject, html: m.html, text: m.text }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function sendWhatsApp(to: string, l: Lead, slot: Slot | null) {
  const booked = !!l.booking;
  const res = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to, type: "template",
      template: { name: booked ? WA_BOOKED : WA_TEMPLATE, language: { code: WA_LANG },
                  components: [{ type: "body", parameters: [{ type: "text", text: firstName(l.name) },
                                                            { type: "text", text: booked ? (slot?.when ?? "the time you picked") : BOOKING_URL }] }] },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!SERVICE_KEY || token !== SERVICE_KEY) return json({ error: "Service role only" }, 403);
  if (!/^https:\/\//.test(BOOKING_URL)) return json({ waiting: "BOOKING_URL is not set; nothing sent" });

  const { data, error } = await admin.rpc("cx_lead_outreach_due", { p_limit: 25 });
  if (error) return json({ error: error.message }, 500);
  const leads = (data ?? []) as Lead[];
  const key = await resendKey();
  const waReady = !!(WA_TOKEN && WA_PHONE_ID);
  let emails = 0, whatsapps = 0;
  const errors: string[] = [];

  for (const l of leads) {
    let slot: Slot | null = null;
    if (l.booking) { try { slot = await bookedSlot(l.booking); } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); } }
    if (l.email_status === "pending") {
      if (!key) { errors.push("no Resend key"); }
      else {
        try { await sendEmail(key, l, slot); await admin.rpc("cx_lead_outreach_mark", { p_lead: l.lead_id, p_channel: "email", p_status: "sent" }); emails++; }
        catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(msg);
          await admin.rpc("cx_lead_outreach_mark", { p_lead: l.lead_id, p_channel: "email", p_status: "failed", p_error: msg });
          await admin.rpc("cx_lead_outreach_mark", { p_lead: l.lead_id, p_channel: "email", p_status: "pending" });   // try again next run (max 3)
        }
      }
    }
    if (l.wa_status === "pending") {
      const to = waNumber(l.phone);
      const why = !to ? "no valid WhatsApp number" : !l.whatsapp_ok ? "did not ask for WhatsApp" : !l.wa_window ? "older than 48 hours"
                : !waReady ? "WhatsApp Business is not connected yet" : "";
      if (why) { await admin.rpc("cx_lead_outreach_mark", { p_lead: l.lead_id, p_channel: "whatsapp", p_status: "skipped", p_error: why }); continue; }
      try { await sendWhatsApp(to!, l, slot); await admin.rpc("cx_lead_outreach_mark", { p_lead: l.lead_id, p_channel: "whatsapp", p_status: "sent" }); whatsapps++; }
      catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(msg);
        await admin.rpc("cx_lead_outreach_mark", { p_lead: l.lead_id, p_channel: "whatsapp", p_status: "failed", p_error: msg });
        await admin.rpc("cx_lead_outreach_mark", { p_lead: l.lead_id, p_channel: "whatsapp", p_status: "pending" });
      }
    }
  }
  return json({ leads: leads.length, emails, whatsapps, whatsapp_connected: waReady, errors });
});
