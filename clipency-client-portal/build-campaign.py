#!/usr/bin/env python3
"""
Assembles campaign.html from the five standalone campaign pages.

Run from inside clipency-client-portal/:   python3 build-campaign.py

Why a generator instead of a hand-written merged file: the five pages contain
~250 lines of markup, ~245 lines of page CSS and ~690 lines of script between
them. Transcribing that by hand invites silent typos. This extracts the exact
bytes from the sources, so the merged page cannot drift from them, and it can
be re-run after editing any source page.

What it handles that a naive concatenation would get wrong:

  1. ID collisions. Seven IDs are reused across pages (#footNote is in all
     five). Rather than rename them in both markup and script, each section's
     IIFE receives a `document` PROXY scoped to its own section, so
     getElementById resolves within that section first. Zero edits to the
     page scripts.

  2. CSS collisions. .clip-cell .t, .filter-row and .panel.mt are defined
     differently by different pages. Every page's CSS is prefixed with
     [data-view="<key>"] so it can only apply inside its own section.

  3. emptyState(). Each IIFE calls CLIPSHELL.emptyState(), which overwrites
     .content wholesale — that would destroy all five sections. It is called
     once up front instead, and sections are only defined if it returns false.
"""

import re, sys, os

SECTIONS = [
    ('overview',  'dashboard.html', 'Overview'),
    ('clips',     'clips.html',     'Clips Feed'),
    ('analytics', 'analytics.html', 'Analytics'),
    ('billing',   'billing.html',   'Spend & Billing'),
    ('creators',  'creators.html',  'Creators'),
]
OUT = 'campaign.html'

# selectors that must stay global — they target things outside any section
GLOBAL_PREFIXES = ('body', 'html', ':root', '@', '*', '.modal', '.toast')


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def grab_style(html):
    m = re.search(r'<style>(.*?)</style>', html, re.S)
    return m.group(1) if m else ''


def grab_content(html):
    """inner HTML of <main class="content"> ... </main>"""
    m = re.search(r'<main class="content">(.*?)</main>', html, re.S)
    if not m:
        raise SystemExit('could not find <main class="content"> block')
    return m.group(1)


def grab_extra(html):
    """markup between </main> and the script tags (modals), minus the shell divs"""
    after = html.split('</main>', 1)[1].split('<script src="./data.js">')[0]
    return re.sub(r'^\s*</div>\s*</div>\s*', '', after).strip()


def grab_iife(html):
    """everything after CLIPSHELL.init('x'); up to the closing </script>"""
    m = re.search(r"CLIPSHELL\.init\('[^']+'\);(.*?)</script>", html, re.S)
    if not m:
        raise SystemExit('could not find CLIPSHELL.init(...) / IIFE block')
    return m.group(1).strip()


def scope_css(css, key):
    """
    Prefix every rule with [data-view="key"] so a page's CSS can only apply
    inside its own section. Handles @media by recursing into it.
    """
    scope = '[data-view="%s"]' % key
    out, unscoped = [], []
    i, n = 0, len(css)

    while i < n:
        # pass comments through untouched
        if css.startswith('/*', i):
            j = css.find('*/', i + 2)
            j = n if j == -1 else j + 2
            out.append(css[i:j]); i = j; continue

        brace = css.find('{', i)
        if brace == -1:
            out.append(css[i:]); break

        selector = css[i:brace].strip()

        # find the matching close brace (nesting-aware, for @media)
        depth, j = 1, brace + 1
        while j < n and depth:
            if css[j] == '{': depth += 1
            elif css[j] == '}': depth -= 1
            j += 1
        body = css[brace + 1:j - 1]

        if selector.startswith('@media') or selector.startswith('@supports'):
            inner, u = scope_css(body, key)
            unscoped += u
            out.append('%s{%s}' % (selector, inner))
        elif selector.startswith('@'):
            out.append('%s{%s}' % (selector, body))          # keyframes etc.
        else:
            parts = []
            for one in selector.split(','):
                one = one.strip()
                if not one:
                    continue
                if one.startswith(GLOBAL_PREFIXES):
                    parts.append(one)
                    unscoped.append(one)
                else:
                    parts.append('%s %s' % (scope, one))
            out.append('%s{%s}' % (', '.join(parts), body))

        i = j

    return ''.join(out), unscoped


def main():
    missing = [f for _, f, _ in SECTIONS if not os.path.exists(f)]
    if missing:
        raise SystemExit('missing source pages: %s' % ', '.join(missing))

    styles, contents, extras, scripts, notes = [], [], [], [], []

    for key, fname, label in SECTIONS:
        html = read(fname)
        scoped, unscoped = scope_css(grab_style(html), key)
        styles.append('/* ---- %s (from %s) ---- */\n%s' % (label, fname, scoped))
        if unscoped:
            notes.append('%s: left global -> %s' % (fname, ', '.join(sorted(set(unscoped)))))

        contents.append(
            '      <section class="cx-view" data-view="%s" role="tabpanel" '
            'aria-label="%s" hidden>\n%s\n      </section>'
            % (key, label, grab_content(html).rstrip())
        )

        extra = grab_extra(html)
        if extra:
            extras.append('<!-- ===== %s: markup outside <main> ===== -->\n%s' % (label, extra))

        scripts.append(
            "CX.define('%s', function(document){\n%s\n});" % (key, grab_iife(html))
        )

    page = TEMPLATE.format(
        styles='\n\n'.join(styles),
        sections='\n\n'.join(contents),
        extras='\n\n'.join(extras),
        definitions='\n\n'.join(scripts),
        keys=', '.join("'%s'" % k for k, _, _ in SECTIONS),
    )

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(page)

    print('wrote %s  (%.1f KB)' % (OUT, len(page) / 1024))
    for k, fn, _ in SECTIONS:
        print('   section %-10s <- %s' % (k, fn))
    if notes:
        print('\nselectors intentionally left unscoped:')
        for nline in notes:
            print('   ' + nline)


TEMPLATE = r'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Clipency — Campaign Dashboard</title>
<meta name="description" content="Your Clipency campaign — clips, analytics, spend and creators in real time.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
<script>
(function(){{try{{
  document.documentElement.setAttribute('data-theme', localStorage.getItem('clipency-theme') || 'light');
  if(sessionStorage.getItem('clipency-access') !== 'granted') location.replace('./login.html');
}}catch(e){{ document.documentElement.setAttribute('data-theme','light'); }}}})();
</script>
<link rel="stylesheet" href="./dashboard.css">
<style>
/* ============================================================
   GENERATED FILE — do not edit by hand.
   Produced by build-campaign.py from dashboard/clips/analytics/
   billing/creators .html. Edit those, then re-run the script.
   ============================================================ */

/* Section visibility. [hidden] alone is not enough because several rules in
   the page CSS below set `display`, which would override it. */
.cx-view[hidden]{{ display:none !important; }}

{styles}
</style>
</head>
<body>
<div class="paper-field" aria-hidden="true"></div>
<div class="shell">
  <div id="side"></div>
  <div class="main">
    <div id="topbar"></div>
    <main class="content">

{sections}

    </main>
  </div>
</div>

{extras}

<script src="./data.js"></script>
<script src="./db.js"></script>
<script src="./export.js"></script>
<script src="./shell.js"></script>
<script src="./tour.js"></script>
<!-- live data (read-only production Supabase) -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="./config.js"></script>
<script src="./js/live.js"></script>

<script type="module">
/* wait for live production data before painting; resolves to 'live' or 'mock' */
if (window.CLIPENCY_LIVE) {{
  try {{ await window.CLIPENCY_LIVE.ready; }}
  catch (e) {{ console.error('[clipency] live load threw, painting anyway', e); }}
}}

/* ============================================================
   Section router
   ------------------------------------------------------------
   Five sections in one document. Switching does not navigate: no request,
   no re-parse, no re-run of data.js. Each section's original page script is
   registered here and executed ONCE, on first view — so the initial paint
   costs one section, not five, and nothing re-binds on later switches
   (which is also what keeps listeners from accumulating).
   ============================================================ */
const KEYS = [{keys}];

const CX = (function () {{
  const defs = {{}};
  const booted = {{}};
  let current = null;

  /* Scoped document proxy.

     Seven IDs are duplicated across the source pages (#footNote exists in all
     five). Instead of renaming them in both markup and script, each section's
     code runs with a `document` that resolves within its own section first and
     falls back to the real document for anything outside it (the sidebar,
     topbar, modals). Everything else — createElementNS, addEventListener —
     passes straight through. */
  function scopedDocument(root) {{
    return new Proxy(document, {{
      get(target, prop) {{
        if (prop === 'getElementById') {{
          return function (id) {{
            let el = null;
            try {{ el = root.querySelector('#' + CSS.escape(id)); }} catch (e) {{}}
            return el || target.getElementById(id);
          }};
        }}
        if (prop === 'querySelector') {{
          return function (sel) {{
            let el = null;
            try {{ el = root.querySelector(sel); }} catch (e) {{}}
            return el || target.querySelector(sel);
          }};
        }}
        if (prop === 'querySelectorAll') {{
          return function (sel) {{
            let list = [];
            try {{ list = root.querySelectorAll(sel); }} catch (e) {{}}
            return list.length ? list : target.querySelectorAll(sel);
          }};
        }}
        const v = target[prop];
        return typeof v === 'function' ? v.bind(target) : v;
      }}
    }});
  }}

  function define(key, fn) {{ defs[key] = fn; }}

  function boot(key) {{
    if (booted[key] || !defs[key]) return;
    booted[key] = true;
    const root = document.querySelector('.cx-view[data-view="' + key + '"]');
    if (!root) return;
    const t0 = performance.now();
    try {{
      defs[key](scopedDocument(root));
    }} catch (e) {{
      console.error('[clipency] section "' + key + '" failed to render', e);
      booted[key] = false;   // let a later switch retry
      return;
    }}
    if (window.CLIPENCY_DEBUG) {{
      console.log('[clipency] rendered ' + key + ' in ' +
        Math.round(performance.now() - t0) + 'ms');
    }}
  }}

  function paint(key) {{
    KEYS.forEach(function (k) {{
      const el = document.querySelector('.cx-view[data-view="' + k + '"]');
      if (el) el.hidden = (k !== key);
    }});
    boot(key);
    syncChrome(key);
    current = key;
  }}

  /* keep sidebar highlight + breadcrumb in step without rebuilding the shell */
  function syncChrome(key) {{
    document.querySelectorAll('.snav a[data-nav]').forEach(function (a) {{
      a.classList.toggle('on', a.dataset.nav === key);
    }});
    const page = (CLIPSHELL.PAGES || []).filter(function (p) {{ return p.key === key; }})[0];
    const crumb = document.querySelector('.crumb');
    if (page && crumb) {{
      crumb.innerHTML = '<b>Campaign Dashboard</b> &nbsp;/&nbsp; ' + page.label;
    }}
    if (page) document.title = 'Clipency — ' + page.label;
  }}

  function go(key, opts) {{
    opts = opts || {{}};
    if (KEYS.indexOf(key) === -1) key = KEYS[0];
    if (key === current && !opts.force) return;

    /* Deliberately NOT using document.startViewTransition here.

       The measured DOM swap is 3-10ms. Wrapping that in a view transition
       added ~320ms of crossfade (the ::view-transition-*(cx-content) rules,
       which exist for cross-document navigation) — which is the entire
       perceptible cost of switching. At this speed there is nothing to hide,
       so the section just appears, with a short opacity fade from CSS
       (.cx-view:not([hidden])) to soften the swap without delaying it. */
    paint(key);

    if (!opts.replace) {{
      history.pushState({{ view: key }}, '', '?view=' + key);
    }}
    /* a section change is a new "page" as far as reading position goes */
    if (!opts.keepScroll) window.scrollTo({{ top: 0, behavior: 'instant' }});
  }}

  return {{ define: define, go: go, boot: boot,
           get current() {{ return current; }} }};
}})();

window.CX = CX;

/* ---- which section to open ---------------------------------------------- */
function wanted() {{
  const q = new URLSearchParams(location.search).get('view');
  return KEYS.indexOf(q) > -1 ? q : KEYS[0];
}}

CLIPSHELL.init(wanted());

/* ---- turn the sidebar into section switches ----------------------------- */
(function wireNav() {{
  /* Derived from CLIPSHELL.PAGES rather than hardcoded: shell.js writes
     hrefs as "dashboard.html", not "./dashboard.html", and a hardcoded map
     silently matched nothing. Reading the source of truth also means adding
     a page to shell.js can't desync this. */
  const MAP = {{}};
  (CLIPSHELL.PAGES || []).forEach(function (p) {{
    if (p.href && KEYS.indexOf(p.key) > -1) {{
      MAP[p.href.replace(/^\.\//, '')] = p.key;
    }}
  }});

  document.querySelectorAll('.snav a[href]').forEach(function (a) {{
    const key = MAP[a.getAttribute('href').replace(/^\.\//, '')];
    if (!key) return;
    a.dataset.nav = key;
    /* real href so middle-click / cmd-click / "open in new tab" still work,
       and so the link is meaningful with JS disabled */
    a.setAttribute('href', '?view=' + key);
    a.addEventListener('click', function (e) {{
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      CX.go(key);
    }});
  }});

  /* prefetch hints from shell.js pointed at the old separate pages; in one
     document they would just refetch this same file five times */
  document.querySelectorAll('link[rel="prefetch"]').forEach(function (l) {{
    l.remove();
  }});
}})();

/* ---- browser back / forward -------------------------------------------- */
window.addEventListener('popstate', function (e) {{
  const key = (e.state && e.state.view) || wanted();
  CX.go(key, {{ replace: true }});
}});

/* ============================================================
   Section definitions — verbatim from the original pages.
   Each receives a section-scoped `document`.
   ============================================================ */
{definitions}

/* ---- first paint -------------------------------------------------------- */
/* emptyState() replaces .content wholesale, which would delete every section,
   so it runs ONCE here rather than inside each section. When a campaign has no
   clips there is nothing to show in any section anyway. */
if (!CLIPSHELL.emptyState()) {{
  history.replaceState({{ view: wanted() }}, '', '?view=' + wanted());
  CX.go(wanted(), {{ replace: true, noAnim: true, force: true, keepScroll: true }});
}}

/* refresh the visible section if a background revalidate brings new numbers */
document.addEventListener('clipency:data-ready', function (e) {{
  if (e.detail && e.detail.refreshed && CX.current) {{
    location.reload();
  }}
}});
</script>
</body>
</html>
'''


if __name__ == '__main__':
    main()
