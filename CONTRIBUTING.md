# Contributing to Clipency

Internal dev guide for the Clipency team.

## Ground Rules

1. **One session for code changes.** Only one active Claude/AI session should touch the repo at a time. Parallel sessions have caused `vercel.json` overwrites in the past.
2. **Never commit backup files.** The `.gitignore` blocks `*.backup-*` patterns. If you need to save a version, use git itself — that's what it's for.
3. **No root-level `clipency-*.js` files.** All JS lives in `auth/`. Root-level files shadow `vercel.json` rewrites and break routing silently.
4. **Syntax-check before pushing.** Run `node --check auth/your-file.js` before every commit.
5. **Schema changes go through migrations.** Use `apply_migration` via Supabase MCP — never raw SQL directly on production.

## Commit Style

```
fix: short description of what was broken
feat: short description of new capability
chore: maintenance, cleanup, deps
docs: readme, comments, documentation
```

## File Locations

| What | Where |
|---|---|
| Landing page | `index.html` (root) |
| All authenticated pages | `auth/` |
| Admin panel JS | `auth/clipency-admin-os.js` |
| Dashboard core | `auth/clipency-functional-core.js` |
| Dashboard HTML | `auth/dashboard.html` |
| Supabase client | `auth/supabaseClient.js` |
| Route config | `vercel.json` (root) |

## Deploying

Push to `main` — Vercel auto-deploys. Done.

Commit as the GitHub account that is linked to Vercel. From a local clone that means

```bash
git config user.name "Ayush Bera"
git config user.email "155877069+AyushBera19@users.noreply.github.com"
```

A commit authored with any other address (for example `ayush@clipency.in`) is pushed fine but
Vercel marks the deployment **Blocked** ("couldn't find a Git account for the commit author") and
the site keeps serving the previous deploy. Fix by pushing a new commit with the right author.

If a deploy doesn't pick up changes, check for Vercel CDN caching: compare the live domain response vs the `.vercel.app` preview URL.

## Supabase RPC Pattern

```sql
CREATE OR REPLACE FUNCTION your_function()
RETURNS ... 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT cx_is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  -- your logic
END;
$$;

REVOKE EXECUTE ON FUNCTION your_function() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION your_function() TO authenticated;
```

Always `REVOKE FROM PUBLIC` — anon role inherits PUBLIC.
