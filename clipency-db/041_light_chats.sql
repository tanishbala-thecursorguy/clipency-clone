-- 041: lighter chats for the small (Nano) database, owner's request 2026-10-24.
-- * Realtime off for the chat tables (the dashboards refresh every 10-60s instead).
-- * Group chat messages are deleted 1 hour after they're sent (was 12).
-- * The cleanup job runs every 10 minutes.
-- Only things added in 038/039 change. Safe to re-run.

do $$
declare t text;
begin
  foreach t in array array['appeals','appeal_messages','campaign_chats','campaign_chat_messages'] loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end $$;

create or replace function public.cx_gc_ttl_hours() returns int language sql immutable set search_path = public as $$ select 1 $$;

do $cron$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'cx_gc_purge';
  perform cron.schedule('cx_gc_purge', '*/10 * * * *', 'select public.cx_gc_purge();');
end $cron$;
