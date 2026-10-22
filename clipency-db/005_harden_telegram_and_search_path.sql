/* Applied to spwtkdgpgeutrhwcjrpy on 2026-09-09.
   Two hardening items found while auditing the private-campaign work.
   Neither was a live hole — both are the belt behind the braces.

   1. telegram_config and telegram_pending_actions ran with RLS OFF. They
      were not reachable from the API because neither anon nor authenticated
      holds a grant on them, which is why nothing leaked. But "safe because
      of a grant nobody has added back yet" is thin for a table holding bot
      credentials. RLS with no policies makes the deny explicit; the
      SECURITY DEFINER tg_* trigger functions run as the owner and bypass
      it, so Telegram notifications are unaffected. Verified by submitting
      a clip as an ordinary clipper afterwards — the notify trigger reads
      telegram_config on every submission, so a mistake here would have
      broken every clip submission on the platform.

   2. clipper_submit_clip was SECURITY DEFINER with an unpinned
      search_path — the classic shape for a search-path attack, since the
      caller chooses which schema unqualified names resolve in. The DO
      block pins every definer function that was missing it, so this stays
      true for anything added since. */

alter table public.telegram_config          enable row level security;
alter table public.telegram_pending_actions enable row level security;

comment on table public.telegram_config is
  'Bot configuration. RLS enabled with no policies on purpose: nothing but the owner (and therefore the SECURITY DEFINER tg_* functions) may read it. Do not grant anon or authenticated access to this table.';

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
      and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path to ''public''', r.sig);
    raise notice 'pinned search_path on %', r.sig;
  end loop;
end $$;
