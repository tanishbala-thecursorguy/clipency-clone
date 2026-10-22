# Clipency — Client Portal

The client-facing dashboard: a brand logs in and sees the clips creators made for
their campaign, the views, the spend against budget, and can flag a clip.

Static HTML/CSS/vanilla JS. No build step. Deployed on Vercel.

---

## ⚠️ This deployment reads the PRODUCTION database

`config.js` points at `spwtkdgpgeutrhwcjrpy.supabase.co` — the live Clipency
project. That is deliberate: this is a test *front end* on real data.

Two rails keep it safe:

| Rail | Where | Effect |
|---|---|---|
| `READ_ONLY: true` | `config.js` | every `insert` / `update` / `upsert` / `delete` / `rpc` throws at the client wrapper |
| Anon key only | `config.js` | no `service_role` key anywhere in this repo |

**Do not set `READ_ONLY: false`** unless you specifically intend to write real
rows. There is no undo.

Open `/diagnostics.html` on any deployment to see exactly what it is connected to.

---

## Layout

```
config.js            ← the only file you normally edit
js/live.js           ← read-only loader: Supabase → window.CLIPENCY
data.js              ← mock data + all the derived-metric helpers
db.js                ← wallet / campaigns store (localStorage, not yet Supabase)
shell.js tour.js     ← nav shell, onboarding tour
export.js            ← CSV / report export
dashboard.css        ← all styling

login.html           ← entry (6-digit access code — not real auth yet)
home.html            ← campaign picker
dashboard.html       ← campaign overview
clips.html           ← clip grid + flagging
analytics.html       ← charts
budget.html          ← budget vs spend
billing.html         ← invoice view
creators.html        ← creator roster
profile.html         ← account settings
landing.html         ← marketing page
diagnostics.html     ← connection self-test
```

## How live data gets in

`data.js` defines `window.CLIPENCY` with mock rows and a set of helpers
(`totals()`, `daily()`, `byCreator()`, …). Those helpers close over the
submissions array, so `js/live.js` **mutates it in place** rather than
reassigning it.

Each page's inline script is `type="module"` and starts with
`await window.CLIPENCY_LIVE.ready`, so it paints once — with live data — instead
of flashing mock data first.

Field mapping lives in `mapRow()` in `js/live.js`. The non-obvious ones:

- `views_count`, not `views` — `views` is legacy and zero
- `platform` is `"Instagram"` in the DB, lowercased for the CSS
- spend **sums `approved_amount`**; it is not recomputed from CPM
- `rate_per_million_usd` is per *million*, divided by 1000 for the per-1k display
- `handle` sometimes contains a full Instagram URL, so it gets cleaned

## Columns production doesn't have yet

`title` and `cover_url` don't exist on `clip_submissions`. `js/live.js` detects
this (PostgREST `42703`), retries without them, and falls back:

- `title` → `campaign_title`
- `cover_url` → YouTube thumbnail derived from `clip_url`; Instagram gets none

When the migration in `../BACKEND-INTEGRATION.md` §5 lands, they're picked up
automatically — no code change.

## If live data doesn't load

The page shows mock data with an amber banner instead of going blank
(`FALLBACK_TO_MOCK`). `/diagnostics.html` and the browser console say why.
The usual causes: the anon key was rotated, RLS was enabled on
`clip_submissions`, or the campaign has no rows visible to anon.

> Note: this portal currently reads `clip_submissions` **unauthenticated**, which
> works only because that table is missing an RLS policy — see
> `../BACKEND-INTEGRATION.md` §4. That hole should be closed. When it is, this
> portal needs the `client` role + real Supabase auth to keep working. Treat the
> current setup as a preview, not a foundation.

## Run it locally

```bash
npx http-server . -p 8080 -c-1
# → http://localhost:8080/diagnostics.html
```

In a Codespace this starts automatically on port 8080.

## Deploy

Vercel → Add New → Project → import this repo → framework preset **Other**,
no build command. `vercel.json` handles routing and sets `noindex`.

Never commit the `.vercel/` folder — it ties the repo to one Vercel project.

## Not done yet

- Real auth (still a 6-digit code; needs `supabase.auth.signInWithOtp`)
- Flags persist to `localStorage`, not the `clip_flags` table
- Wallet/campaigns in `db.js` are still localStorage
