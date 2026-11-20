-- 070: save ScrapeCreators credits (owner OK, 2026-11-20).
-- The hourly views job re-reads clips older than 30 days every 3 days instead of every day.
-- Clips under 3 days old stay at every 12 hours, everything else at every 24 hours.
-- Refresh-on-open (clips_due_on_open) is unchanged.

create or replace function pg_temp.cx_patch(p_fn regprocedure, p_from text, p_to text, p_count int)
returns void language plpgsql as $$
declare d text; n int;
begin
  d := pg_get_functiondef(p_fn);
  n := (length(d) - length(replace(d, p_from, ''))) / length(p_from);
  if n <> p_count then raise exception 'patch %: expected % match(es), found %', p_fn, p_count, n; end if;
  execute replace(d, p_from, p_to);
end $$;

select pg_temp.cx_patch('public.clips_due_for_metrics(integer)',
  $a$case when now() - s.created_at < interval '3 days'
                                             then interval '11 hours 50 minutes'$a$,
  $b$case when now() - s.created_at < interval '3 days'
                                             then interval '11 hours 50 minutes'
                                             when now() - s.created_at > interval '30 days'
                                             then interval '71 hours 50 minutes'$b$, 1);
