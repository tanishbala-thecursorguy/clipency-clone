#!/usr/bin/env python3
"""
Apply the Clipathon routing and hygiene changes to a Clipency checkout.

Run this INSIDE your cloned repo, not against a downloaded copy. It edits
three files in place and it is safe to run twice: every change checks for
itself first, so a second run reports "already there" and touches nothing.

    python3 apply-clipathon-routes.py            # apply
    python3 apply-clipathon-routes.py --check    # say what would change, write nothing

Why a script instead of three files to copy: your vercel.json is the one
file CONTRIBUTING.md says has been overwritten by parallel sessions before.
Copying a version from a detached folder over the repo's current one is how
that happens. This only ever adds, and only what is missing.
"""

import json, sys, os, collections

CHECK = '--check' in sys.argv
changed, skipped, problems = [], [], []

def note(ok, msg):
    (changed if ok else skipped).append(msg)

# ---------------------------------------------------------------- vercel.json
ROUTES = [
    ('/clipathon/demo',      '/clipathon-admin-demo'),
    ('/clipathon/admin',     '/clipathon-admin'),
    ('/clipathon/dashboard', '/clipathon-dashboard'),
    ('/clipathon/signin',    '/clipathon-signin'),
    ('/clipathon/register',  '/clipathon-register'),
]
NOINDEX_PATHS = ['/clipathon-admin', '/clipathon-admin-demo', '/clipathon/admin', '/clipathon/demo']

def do_vercel():
    p = 'vercel.json'
    if not os.path.exists(p):
        problems.append('vercel.json not found. Are you in the repo root?')
        return
    try:
        cfg = json.load(open(p, encoding='utf-8'), object_pairs_hook=collections.OrderedDict)
    except Exception as e:
        problems.append('vercel.json is not valid JSON: %s' % e)
        return

    cfg.setdefault('rewrites', [])
    cfg.setdefault('headers', [])

    # Prepended, so these can never be shadowed by a catch-all added later.
    have = {r.get('source') for r in cfg['rewrites']}
    for src, dst in reversed(ROUTES):
        if src in have:
            note(False, 'route %s already present' % src)
            continue
        cfg['rewrites'].insert(0, collections.OrderedDict(
            [('source', src), ('destination', dst)]))
        note(True, 'route %s -> %s' % (src, dst))

    # A header a crawler cannot miss, for pages that also carry a noindex tag.
    for src in NOINDEX_PATHS:
        if any(h.get('source') == src for h in cfg['headers']):
            note(False, 'noindex header for %s already present' % src)
            continue
        cfg['headers'].append(collections.OrderedDict([
            ('source', src),
            ('headers', [collections.OrderedDict([
                ('key', 'X-Robots-Tag'),
                ('value', 'noindex, nofollow, noarchive')])]),
        ]))
        note(True, 'noindex header for %s' % src)

    if not CHECK:
        json.dump(cfg, open(p, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
        open(p, 'a', encoding='utf-8').write('\n')

# ------------------------------------------------------------- .vercelignore
VIGNORE = """
# Database migrations. Not secrets, but serving them hands anyone a complete
# map of the schema, every RLS policy and every function body. RLS is still
# the real gate; there is just no reason to publish the map.
clipathon-db/
*.sql

# Source notes and specs
*.docx
*.xlsx
"""

def do_vercelignore():
    p = '.vercelignore'
    s = open(p, encoding='utf-8').read() if os.path.exists(p) else ''
    if 'clipathon-db/' in s:
        note(False, '.vercelignore already excludes the migrations')
        return
    note(True, '.vercelignore now excludes clipathon-db/ and *.sql')
    if not CHECK:
        open(p, 'w', encoding='utf-8').write(s.rstrip('\n') + '\n' + VIGNORE)

# ------------------------------------------------------------------ robots.txt
ROBOTS = """
# The operations console and its demo are not public surfaces. Both pages
# also carry a noindex meta tag and an X-Robots-Tag header; this is the
# third layer, for crawlers that read this file and nothing else.
Disallow: /clipathon-admin
Disallow: /clipathon-admin-demo
Disallow: /clipathon/admin
Disallow: /clipathon/demo
Disallow: /clipathon-db/
"""

def do_robots():
    p = 'robots.txt'
    if not os.path.exists(p):
        note(False, 'no robots.txt, skipping')
        return
    s = open(p, encoding='utf-8').read()
    if 'clipathon-admin' in s:
        note(False, 'robots.txt already covers the console')
        return
    note(True, 'robots.txt now disallows the console and the migrations')
    if CHECK:
        return
    if 'Sitemap:' in s:
        head, _, tail = s.partition('Sitemap:')
        s = head.rstrip('\n') + '\n' + ROBOTS + '\nSitemap:' + tail
    else:
        s = s.rstrip('\n') + '\n' + ROBOTS
    open(p, 'w', encoding='utf-8').write(s)

do_vercel(); do_vercelignore(); do_robots()

print()
if problems:
    for m in problems: print('  STOP    ' + m)
    print('\nNothing was written.')
    sys.exit(1)
for m in changed: print('  ' + ('would add' if CHECK else 'added    ') + '  ' + m)
for m in skipped: print('  skipped    ' + m)
print()
print('%d change%s %s, %d already in place.'
      % (len(changed), '' if len(changed) == 1 else 's',
         'to make' if CHECK else 'written', len(skipped)))
if changed and not CHECK:
    print('\nCheck it parsed:  python3 -c "import json;json.load(open(\'vercel.json\'));print(\'valid\')"')
    print('Then:             git diff')
