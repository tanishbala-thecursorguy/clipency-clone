<p align="center">
  <img src="Clipencylogo.png" width="180" alt="Clipency" />
</p>

<h1 align="center">Clipency</h1>
<p align="center"><b>The Viral Creator Network</b> — performance-based content distribution connecting brands with professional clippers.</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-in%20production-brightgreen?style=flat-square" />
  <img src="https://img.shields.io/badge/frontend-HTML%20%2F%20CSS%20%2F%20Vanilla%20JS-F7DF1E?style=flat-square&logo=javascript&logoColor=black" />
  <img src="https://img.shields.io/badge/backend-Supabase-3ECF8E?style=flat-square&logo=supabase&logoColor=white" />
  <img src="https://img.shields.io/badge/hosting-Vercel-000000?style=flat-square&logo=vercel&logoColor=white" />
</p>

<p align="center"><b>Live:</b> <a href="https://www.clipency.in">clipency.in</a></p>

---

## What is Clipency?

Clipency is a marketplace where brands launch pay-per-view campaigns and "clippers" (short-form content creators) earn by submitting clips that get views. No fixed fees, no upfront risk — brands pay only for verified views delivered.

**Core loop:**
1. Brand creates a campaign with a CPM budget
2. Clippers browse campaigns, submit short-form clips (TikTok / Reels / Shorts)
3. Admin reviews submissions → approved clips go live
4. Views get tracked → clippers earn → brands pay on results

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Static HTML / CSS / Vanilla JS |
| Hosting | Vercel (main) · `clipency.in` |
| Backend | Supabase (PostgreSQL + Auth + Edge Functions) |
| Finance Dashboard | Next.js · `finance.clipency.in` |
| Ops Bot | COO (Telegram bot via Supabase Edge Functions + pg_net) |
| Analytics | Custom Supabase views + admin panel |

---

## Repo Structure

```
/
├── index.html              # Public landing page
├── vercel.json             # Routing rewrites + security headers
├── robots.txt / sitemap.xml
├── og-cover.png            # Open Graph image
├── Clipencylogo.png        # Brand logo
├── mascot logo.png         # Mascot / favicon
│
├── auth/                   # All authenticated pages and JS
│   ├── index.html          # Landing (auth-aware copy)
│   ├── dashboard.html/.js/.css   # Clipper dashboard
│   ├── profile/            # Profile page
│   ├── campaigns/          # Campaign browser
│   ├── accounts/           # Connected social accounts
│   ├── payouts/            # Payout history
│   ├── stats/              # Clipper stats
│   ├── login/ signup/      # Auth pages
│   ├── admin/              # Admin OS (admin-only)
│   ├── review/             # Reviewer-only submission review
│   ├── clipency-admin-os.js     # Main admin SPA
│   ├── clipency-functional-core.js  # Dashboard core logic
│   ├── supabaseClient.js   # Supabase init (anon key)
│   └── ...
│
├── accounts/               # Public-facing account routes
├── admin/                  # Admin shell route
└── landing-mobile/         # Mobile landing variant
```

---

## Key Concepts

### Roles
- **Clipper** — creator who submits clips and earns per view
- **Brand** — company/creator who launches campaigns
- **Admin** (`admin_users` table) — Smit + Ayush, full platform access
- **Reviewer** (`reviewer_users` table) — limited access: can approve/reject submissions only

### Supabase Security Pattern
All privileged RPCs follow:
```sql
SECURITY DEFINER
+ cx_is_admin() / cx_is_staff() gate
+ REVOKE EXECUTE FROM PUBLIC
+ GRANT EXECUTE TO authenticated
```
`cx_is_staff()` is `SECURITY DEFINER` — always use this inside RLS policies, never inline subqueries (they run as the calling user and silently fail).

### Vercel Routing
`vercel.json` rewrites bare URLs to `auth/`:
- `/login` → `/auth/login`
- `/dashboard` → `/auth/profile`
- `/admin/*` → `/auth/admin`
- `/*.js` → `/auth/*.js`

> **Important:** Physical files at repo root take precedence over rewrites. Never leave orphaned `clipency-*.js` files at root — they will shadow the `auth/` versions.

### Marshie (COO Bot)
Telegram bot running in the **Clipency Operations** supergroup:
- **Outreach** topic (ID: 10)
- **Operations** topic (ID: 3)
- **Finance** topic (ID: 4)

Bot token stored in `telegram_config` table. Webhook handled by Supabase Edge Function `telegram-webhook` (`verify_jwt: false`).

Digests: 10 AM IST = `30 4 * * *`, 10 PM IST = `30 16 * * *` via `pg_cron`.

---

## Environment / Credentials

Stored in Supabase and Vercel — never committed to the repo.

| Secret | Where |
|---|---|
| Supabase URL + anon key | `auth/supabaseClient.js` (public, safe) |
| Supabase service role key | Vercel env + Edge Functions |
| Telegram bot token | `telegram_config` table in Supabase |

---

## Development

This project runs on **GitHub Codespaces**.

```bash
# Make a change
vim auth/some-file.js

# Syntax check before committing
node --check auth/some-file.js

# Commit and push (auto-deploys to Vercel)
git add -A
git commit -m "fix: description of change"
git push
```

Vercel deploys on every push to `main`. Check [vercel.com](https://vercel.com) or the Clipency Operations Telegram for deployment status.

### Supabase Changes
- **Reads/diagnosis:** use `execute_sql` via MCP
- **Schema changes:** use `apply_migration` via MCP — never raw SQL in production without a migration

---

## Known Footguns

- `.catch()` is invalid on Supabase JS query chains — always use `try/catch`
- `body.cxon > *:not(#cxos) { display:none !important }` hides dynamically appended panels — always append panels to `document.getElementById('cxos')`
- Inline `onclick` attributes break when data contains apostrophes — use `data-*` attributes + delegated event listeners
- PostgREST embedded joins on `auth.users` silently return empty — fetch profiles separately via `.in('id', uids)`
- Vercel CDN aggressively caches 404s as `immutable` — fix by changing the requested URL, not adding rewrite rules
- IST = UTC+5:30: 10 AM IST → `30 4 * * *`, 10 PM IST → `30 16 * * *`

---

## Team

| Person | Role |
|---|---|
| Ayush | Founder / CEO |


---

<p align="center">© 2026 Clipency. Built for the Viral Economy.</p>
