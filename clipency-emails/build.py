"""Clipency transactional emails, built on the Clipathon code-email layout.

Same card, masthead, type scale, colours, dark footer and table-only markup
as the Clipathon sign-in email (tables + inline styles: Gmail and Outlook
strip <style> blocks). Run: python3 build.py  -> writes one .html per email
with sample data, plus preview.html showing them all.
"""
import html, pathlib

ASSETS = "https://kszlfvsplkkmsgxqnakj.supabase.co/storage/v1/object/public/assets"
SITE = "https://www.clipency.in"
PORTAL = SITE + "/client"
SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
SERIF = "Georgia,'Times New Roman',serif"
MONO = "'SF Mono',SFMono-Regular,Menlo,Consolas,monospace"
e = html.escape

def layout(*, label, preheader, title, intro, body, cta_text, cta_href, cta_note="",
           note="", fine="", reason):
    cta_note_html = (f'<p style="margin:11px 0 0;text-align:center;font-size:12px;line-height:1.6;color:#a09a90;">{cta_note}</p>'
                     if cta_note else "")
    note_html = (f'''<tr><td style="padding:18px 38px 0;">
            <p style="margin:0;font-size:13.5px;line-height:1.62;color:#8a8378;">{note}</p></td></tr>''' if note else "")
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>{e(title)}</title></head>
<body style="margin:0;padding:0;background:#faf9f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#faf9f6;font-size:1px;line-height:1px;">{e(preheader)}&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:#faf9f6;margin:0;padding:34px 12px;font-family:{SANS};">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="max-width:504px;background:#ffffff;border:1px solid #e8e4db;border-radius:18px;overflow:hidden;">

        <!-- masthead: logo chip is baked into the PNG so dark mode cannot invert it -->
        <tr>
          <td style="background:#f6f3ec;padding:20px 38px;border-bottom:1px solid #e8e4db;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align:middle;">
                  <img src="{ASSETS}/clipency-logo-chip.png" width="155" height="54" alt="Clipency"
                       style="display:block;width:155px;height:54px;border:0;outline:none;text-decoration:none;color:#14120e;font-size:16px;font-weight:700;letter-spacing:.15em;font-family:{SERIF};">
                </td>
                <td style="vertical-align:middle;padding:0 14px;"><span style="color:#c9c0b0;font-size:16px;">&#124;</span></td>
                <td style="vertical-align:middle;">
                  <span style="font-family:{SERIF};font-size:11px;letter-spacing:.26em;color:#8a6224;text-transform:uppercase;">{e(label)}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:26px 38px 0;">
            <h1 style="margin:0 0 9px;font-family:{SERIF};font-weight:400;font-size:28px;line-height:1.16;color:#14120e;">{title}</h1>
            <p style="margin:0;font-size:15px;line-height:1.62;color:#5a554c;">{intro}</p>
          </td>
        </tr>

{body}

        <tr>
          <td style="padding:22px 38px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="background:#14120e;border-radius:12px;">
                  <a href="{cta_href}" style="display:block;padding:15px 22px;color:#f3efe7;font-size:15px;font-weight:600;letter-spacing:.01em;text-decoration:none;">{cta_text}</a>
                </td>
              </tr>
            </table>
            {cta_note_html}
          </td>
        </tr>
{note_html}
        <tr><td style="padding:22px 38px 0;"><div style="height:1px;background:#eeeae1;"></div></td></tr>
        <tr>
          <td style="padding:18px 38px 30px;">
            <p style="margin:0;font-size:12.5px;line-height:1.62;color:#a09a90;">{fine}</p>
          </td>
        </tr>

        <!-- footer -->
        <tr>
          <td style="background:#14120e;padding:26px 38px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-bottom:16px;">
                  <span style="font-family:{SERIF};font-size:13px;font-weight:700;letter-spacing:.16em;color:#f3efe7;text-transform:uppercase;">Clipency</span>
                  <div style="margin-top:6px;font-size:12.5px;line-height:1.6;color:#8f887c;">Short-form clips, paid on performance.</div>
                </td>
              </tr>
              <tr>
                <td style="padding-bottom:16px;">
                  <a href="https://www.instagram.com/clipency" style="display:block;text-decoration:none;width:22px;">
                    <img src="{ASSETS}/social-instagram.png" width="22" height="22" alt="Instagram"
                         style="display:block;width:22px;height:22px;border:0;outline:none;text-decoration:none;color:#D8AA74;font-size:12px;font-family:Arial,Helvetica,sans-serif;">
                  </a>
                </td>
              </tr>
              <tr>
                <td>
                  <div style="height:1px;background:#2a2622;margin-bottom:14px;"></div>
                  <p style="margin:0;font-size:11.5px;line-height:1.65;color:#6e6860;">
                    <a href="{SITE}" style="color:#8a8177;text-decoration:underline;">clipency.in</a>
                    &#183;
                    <a href="{SITE}/clipathon" style="color:#8a8177;text-decoration:underline;">Clipathon</a>
                    <br>&copy; 2026 Clipency, Inc. All rights reserved.<br>
                    {reason} This mailbox is not monitored.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body></html>
'''

def row(inner, top=24):
    return f'''        <tr>
          <td style="padding:{top}px 38px 0;">
{inner}
          </td>
        </tr>'''

def panel(inner, pad="22px 22px"):
    return f'''            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                   style="background:#f6f3ec;border:1px solid #e6e1d6;border-radius:14px;">
              <tr><td style="padding:{pad};">{inner}</td></tr>
            </table>'''

def big_number(num, caption, sub):
    return panel(f'''<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td align="center" style="padding:6px 0 4px;font-family:{SERIF};font-size:54px;line-height:1;color:#14120e;">{num}</td></tr>
                <tr><td align="center" style="padding:6px 0 0;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#8a6224;">{caption}</td></tr>
                <tr><td align="center" style="padding:10px 0 2px;font-size:13px;line-height:1.55;color:#5a554c;">{sub}</td></tr>
              </table>''', "22px 16px 18px")

def section_label(text):
    return f'<div style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#9a9287;margin:0 0 8px;">{text}</div>'

def list_rows(items):
    """items: (left_html, sub_html, right_html)"""
    out = []
    for i, (left, sub, right) in enumerate(items):
        bt = "" if i == 0 else "border-top:1px solid #eeeae1;"
        out.append(f'''<tr>
                  <td style="padding:11px 0;{bt}font-size:14px;line-height:1.45;color:#14120e;">{left}
                    {f'<div style="font-size:12.5px;color:#8a8378;margin-top:2px;">{sub}</div>' if sub else ''}</td>
                  <td align="right" style="padding:11px 0 11px 12px;{bt}font-size:13px;white-space:nowrap;vertical-align:top;">{right}</td>
                </tr>''')
    return f'''<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                {''.join(out)}
              </table>'''

def facts(pairs):
    out = []
    for i, (k, v) in enumerate(pairs):
        bt = "" if i == 0 else "border-top:1px solid #e6e1d6;"
        out.append(f'''<tr>
                  <td style="padding:10px 0;{bt}font-size:12.5px;color:#8a8378;vertical-align:top;">{k}</td>
                  <td align="right" style="padding:10px 0 10px 14px;{bt}font-size:14px;color:#14120e;font-weight:600;word-break:break-word;">{v}</td>
                </tr>''')
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">{"".join(out)}</table>'

WATCH = lambda url: f'<a href="{url}" style="color:#8a6224;text-decoration:none;">Watch &#8599;</a>'
FINE_CLIENT = (f'You get this because you have access to Vingo on your Clipency dashboard. '
               f'Choose which emails you get, or where they go, in your '
               f'<a href="{PORTAL}/profile.html" style="color:#8a8378;text-decoration:underline;">Profile</a>.')
FINE_CREATOR = ('You get this because you submitted clips with this Clipency account. '
                'Updates about your clips always come from this address.')

# ---------------------------------------------------------------- 1
def review_milestone():
    clips = [("@mercyunnfiltered", "instagram", "Auto-approves in 2h 14m", True),
             ("@nirunfiltered", "instagram", "Auto-approves in 9h 02m", False),
             ("@dishaaaaayapps", "instagram", "Auto-approves in 17h 40m", False),
             ("@nivvy.finds", "instagram", "Auto-approves in 1d 3h", False),
             ("@mercyunnfiltered", "instagram", "Auto-approves in 1d 9h", False)]
    rows = [(f'<b style="font-weight:600;">{h}</b><span style="color:#9a9287;"> &middot; {p}</span>',
             f'<span style="color:{"#a0521f" if soon else "#8a8378"};">{t}</span>',
             WATCH("https://www.instagram.com/reel/DdoydC2tfcZ/")) for h, p, t, soon in clips]
    body = "\n".join([
        row(big_number("20", "clips waiting on Vingo",
                       "The first one approves itself on <b style=\"color:#14120e;\">Thu 1 Oct, 7:41 pm IST</b>.")),
        row(section_label("Soonest first") + list_rows(rows) +
            '<div style="font-size:12.5px;color:#8a8378;padding-top:10px;border-top:1px solid #eeeae1;">and 15 more in Review</div>', 22),
    ])
    return layout(label="Review", preheader="20 clips are waiting on Vingo. The first approves itself Thu 1 Oct, 7:41 pm IST.",
        title="20 clips are waiting for your review.",
        intro="Creators have submitted 20 clips to Vingo that nobody on your team has reviewed yet. Approve the ones you like and reject the rest with a reason the creator will see.",
        body=body, cta_text="Review 20 clips", cta_href=f"{PORTAL}/campaign.html?view=review&amp;campaign=CAMPAIGN_ID",
        note="Anything you have not reviewed is approved automatically 48 hours after it was submitted. We email you again when 30 are waiting.",
        fine=FINE_CLIENT, reason="Sent because clips are waiting for your review.")

# ---------------------------------------------------------------- 2
def weekly_report():
    def kpi(v, l, d, side, up=True):
        col = "#2f7a52" if up else "#a0521f"
        pad = "padding:0 6px 12px 0;" if side == "l" else "padding:0 0 12px 6px;"
        return f'''<td width="50%" style="{pad}vertical-align:top;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f3ec;border:1px solid #e6e1d6;border-radius:12px;">
                    <tr><td style="padding:14px 14px 13px;">
                      <div style="font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:#9a9287;">{l}</div>
                      <div style="font-family:{SERIF};font-size:26px;line-height:1.15;color:#14120e;margin-top:6px;">{v}</div>
                      <div style="font-size:12px;color:{col};margin-top:3px;">{d}</div>
                    </td></tr>
                  </table>
                </td>'''
    grid = f'''<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>{kpi("184.2K", "Views", "&#9650; 32% on last week", "l")}{kpi("14", "Clips approved", "&#9650; 5 on last week", "r")}</tr>
              <tr>{kpi("38", "Clips live", "9 creators posting", "l")}{kpi("&#8377;3,500", "Spent this week", "&#8377;36,000 of &#8377;1,00,000 used", "r")}</tr>
            </table>'''
    small = facts([("Waiting for your review", "3"), ("Rejected this week", "2"), ("Auto-approved (no review)", "1")])
    tops = [(f'<b style="font-family:{SERIF};font-weight:400;color:#8a6224;">{r}</b>&nbsp;&nbsp;<b style="font-weight:600;">{h}</b>',
             f'{v} views &middot; {l} likes', WATCH("https://www.instagram.com/reel/DdoydC2tfcZ/"))
            for r, h, v, l in [("I", "@mercyunnfiltered", "41.3K", "2.1K"), ("II", "@nirunfiltered", "28.9K", "1.4K"), ("III", "@dishaaaaayapps", "17.0K", "912")]]
    body = "\n".join([row(grid, 22), row(panel(small, "6px 18px"), 0), row(section_label("Top clips this week") + list_rows(tops), 24)])
    return layout(label="Weekly report", preheader="Vingo, 23 to 29 Sep: 184.2K views, 14 clips approved, 3 waiting for review.",
        title="Your week on Vingo.",
        intro="Monday 23 to Sunday 29 September. The same numbers you see on your dashboard.",
        body=body, cta_text="Open your dashboard", cta_href=f"{PORTAL}/campaign.html?view=overview&amp;campaign=CAMPAIGN_ID",
        note="Views refresh every hour, so your dashboard may already be ahead of this email.",
        fine=FINE_CLIENT, reason="Sent every Monday while your campaign is running.")

# ---------------------------------------------------------------- 3
def clip_approved():
    body = "\n".join([
        row(panel(facts([("Campaign", "Vingo"), ("Account", "@mercyunnfiltered"),
                         ("Clip", f'<a href="https://www.instagram.com/reel/DdoydC2tfcZ/" style="color:#8a6224;text-decoration:none;font-weight:600;">Instagram reel &#8599;</a>'),
                         ("Approved", "Wed 30 Sep, 5:41 pm IST")]), "6px 18px")),
    ])
    return layout(label="Creators", preheader="Vingo approved your clip.",
        title="Your clip is approved.",
        intro="Vingo approved your clip. It now counts toward the campaign.",
        body=body, cta_text="See it in your dashboard", cta_href=f"{PORTAL}/clipper.html",
        note="Keep the post public and up. Views are checked twice a day at first, then daily while the campaign runs. A deleted or private post stops counting.",
        fine=FINE_CREATOR, reason="Sent because one of your clips was approved.")

# ---------------------------------------------------------------- 4
def clip_rejected():
    reason = panel(f'''<div style="font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:#a0521f;margin-bottom:6px;">Reason from Vingo</div>
                <div style="font-size:15px;line-height:1.55;color:#14120e;">Wrong product or link: the video shows the old pack.</div>''', "16px 18px")
    reason = reason.replace("background:#f6f3ec;border:1px solid #e6e1d6;", "background:#fbf1ec;border:1px solid #efd9cc;")
    # The real email shows this block as an image that renders the time left
    # at the moment the email is opened (a live countdown is impossible in
    # email: no JavaScript). The text line under it is the fallback.
    def unit(v, l):
        return f'''<td align="center" style="padding:0 6px;">
                    <div style="font-family:{MONO};font-size:34px;font-weight:700;color:#14120e;line-height:1.1;">{v}</div>
                    <div style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#9a9287;margin-top:4px;">{l}</div></td>'''
    colon = f'<td style="font-family:{MONO};font-size:28px;color:#c9c0b0;padding-bottom:16px;">:</td>'
    timer = panel(f'''<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
                  {unit("23", "Hours")}{colon}{unit("59", "Min")}{colon}{unit("41", "Sec")}</tr></table>
                <div style="text-align:center;font-size:13px;line-height:1.55;color:#5a554c;margin-top:12px;">Resubmit before <b style="color:#14120e;">Thu 1 Oct, 5:41 pm IST</b></div>''',
                  "22px 12px 18px")
    steps = list_rows([
        ('<b style="font-weight:600;">1.&nbsp; Open the clip and read the reason</b>', "The reason comes straight from the brand.", ""),
        ('<b style="font-weight:600;">2.&nbsp; Post a fixed version</b>', "A new post, so it has a new link.", ""),
        ('<b style="font-weight:600;">3.&nbsp; Submit the new link</b>', "Before the timer runs out.", ""),
    ])
    # Which clip comes first: the creator may have several on the campaign.
    which = panel(facts([("Campaign", "Vingo"), ("Account", "@mercyunnfiltered"),
                         ("Clip", '<a href="https://www.instagram.com/" style="color:#8a6224;text-decoration:none;font-weight:600;">Instagram reel &#8599;</a>'),
                         ("Rejected", "Wed 30 Sep, 5:41 pm IST")]), "6px 18px")
    clip_btn = ('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
                '<td align="center" style="border:1px solid #d9d2c4;border-radius:12px;background:#ffffff;">'
                '<a href="https://www.instagram.com/" style="display:block;padding:13px 22px;color:#14120e;font-size:14px;font-weight:600;text-decoration:none;">'
                'Open the rejected Instagram reel &#8599;</a></td></tr></table>')
    body = "\n".join([row(which, 22), row(clip_btn, 12), row(reason, 22), row(timer, 14), row(section_label("How to fix it") + steps, 22)])
    return layout(label="Creators", preheader="Vingo did not approve your clip. You have 24 hours to fix it and resubmit.",
        title="Your clip needs a redo.",
        intro="Vingo did not approve your Instagram reel for @mercyunnfiltered. You have 24 hours to fix it and submit it again.",
        body=body, cta_text="Fix and resubmit", cta_href=f"{PORTAL}/clipper.html",
        cta_note="Think this is a mistake? Appeal from the clip in your dashboard.",
        fine=FINE_CREATOR, reason="Sent because one of your clips was not approved.")

# ---------------------------------------------------------------- 5
def private_approved():
    info = panel(facts([("Campaign", "Vingo"), ("Approved account", "@mercyunnfiltered"),
                        ("Platform", "Instagram Reels")]), "6px 18px")
    steps = list_rows([
        ('<b style="font-weight:600;">1.&nbsp; Read the brief</b>', "What to show, what to avoid, and the hooks that work.", ""),
        ('<b style="font-weight:600;">2.&nbsp; Post from @mercyunnfiltered</b>', "Clips from any other account are refused.", ""),
        ('<b style="font-weight:600;">3.&nbsp; Submit each link</b>', "The brand reviews it within 48 hours.", ""),
    ])
    body = "\n".join([row(info, 22), row(section_label("How to start") + steps, 22)])
    return layout(label="Creators", preheader="You're in. Your application to Vingo was approved.",
        title="You're in: Vingo.",
        intro="Your application to the private Vingo campaign was approved. Only approved creators can see it and submit to it.",
        body=body, cta_text="Open the campaign brief", cta_href=f"{PORTAL}/clipper.html",
        note="Your spot is for @mercyunnfiltered only. To add another account, apply again from the campaign page.",
        fine=FINE_CREATOR, reason="Sent because your application to a private campaign was approved.")

TEMPLATES = [
    ("01-client-review-milestone", "Client · reviews waiting (every 10)", review_milestone),
    ("02-client-weekly-report", "Client · weekly report", weekly_report),
    ("03-creator-clip-approved", "Creator · clip approved", clip_approved),
    ("04-creator-clip-rejected", "Creator · clip rejected, redo in 24h", clip_rejected),
    ("05-creator-private-approved", "Creator · approved into a private campaign", private_approved),
]

if __name__ == "__main__":
    out = pathlib.Path(__file__).parent
    frames = []
    for slug, name, fn in TEMPLATES:
        h = fn()
        assert "\u2014" not in h, slug
        (out / f"{slug}.html").write_text(h)
        frames.append((slug, name, h))
    tabs = "".join(f'<button data-i="{i}"{" class=on" if i == 0 else ""}>{e(n)}</button>' for i, (s, n, h) in enumerate(frames))
    docs = ",".join(repr(h).replace("</", "<\\/") for _, _, h in frames)
    (out / "preview.html").write_text(f'''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Clipency email templates</title>
<style>
body{{margin:0;background:#ece8e0;font-family:{SANS};color:#14120e}}
header{{padding:22px 20px 8px;text-align:center}} h1{{font-family:{SERIF};font-weight:400;font-size:24px;margin:0 0 4px}}
p{{margin:0;color:#6b655b;font-size:13.5px}}
nav{{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;padding:14px 16px}}
nav button{{border:1px solid #d9d2c4;background:#fff;border-radius:999px;padding:8px 13px;font:500 12.5px {SANS};cursor:pointer;color:#5a554c}}
nav button.on{{background:#14120e;color:#f3efe7;border-color:#14120e}}
.wrap{{display:flex;gap:18px;justify-content:center;padding:0 16px 30px;flex-wrap:wrap}}
.dev{{background:#fff;border-radius:16px;box-shadow:0 20px 50px -30px rgba(0,0,0,.35);overflow:hidden}}
.dev .cap{{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#9a9287;padding:10px 14px;border-bottom:1px solid #eee}}
iframe{{border:0;display:block;background:#faf9f6}}
</style></head><body>
<header><h1>Clipency emails</h1><p>Built on the Clipathon sign-in email. Sample data. Desktop and phone width side by side.</p></header>
<nav>{tabs}</nav>
<div class="wrap">
  <div class="dev"><div class="cap">Desktop</div><iframe id="d" width="640" height="1400"></iframe></div>
  <div class="dev"><div class="cap">Phone</div><iframe id="m" width="375" height="1400"></iframe></div>
</div>
<script>
var D=[{docs}];
function show(i){{document.getElementById('d').srcdoc=D[i];document.getElementById('m').srcdoc=D[i];
document.querySelectorAll('nav button').forEach(function(b){{b.classList.toggle('on',+b.dataset.i===i)}});}}
document.querySelectorAll('nav button').forEach(function(b){{b.onclick=function(){{show(+b.dataset.i)}}}});
['d','m'].forEach(function(id){{var f=document.getElementById(id);f.onload=function(){{try{{f.style.height=(f.contentDocument.documentElement.scrollHeight+4)+'px'}}catch(x){{}}}}}});
show(0);
</script></body></html>''')
    print("wrote", len(frames), "templates")
