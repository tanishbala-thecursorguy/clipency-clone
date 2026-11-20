-- 069: views from rejected clips that are still live count toward VIEW totals (owner, 2026-11-20).
--
-- "Still live" = the views fetcher re-checked the clip after it was rejected (and after this
-- change went in) and the post was still there (metrics_status = 'ok'). A deleted post comes
-- back as an error and drops out. Money never changes: earnings, payouts, client spend,
-- budget_used and the per-clip cost all stay approved-only.
--
-- What changes:
--   * cx_rejected_live(): the one rule, used everywhere below.
--   * clips_due_for_metrics / clips_due_on_open: the fetcher also re-checks rejected clips
--     (once one is found deleted, it stops re-checking it).
--   * campaigns.total_views (trigger), cx_campaign_stats, client_campaign_report: view sums.
--   * client_dashboard_data: new 'views_extra' list (views only, no money, no clip link).
--   * admin_list_creators, admin_creator_detail, v_admin_kpis: console view totals.
-- Each patch below rewrites only the matched text and fails if it does not match exactly.

begin;

create or replace function public.cx_rejected_live(p_status text, p_metrics text, p_fetched timestamptz, p_reviewed timestamptz)
returns boolean language sql immutable as $$
  select coalesce(p_status = 'rejected' and p_metrics = 'ok'
         and p_fetched > greatest(coalesce(p_reviewed, '-infinity'::timestamptz), timestamptz '2026-11-20 00:00+00'), false)
$$;
revoke all on function public.cx_rejected_live(text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.cx_rejected_live(text, text, timestamptz, timestamptz) to authenticated, service_role;

create or replace function pg_temp.cx_patch(p_fn regprocedure, p_from text, p_to text, p_count int)
returns void language plpgsql as $$
declare d text; n int;
begin
  d := pg_get_functiondef(p_fn);
  n := (length(d) - length(replace(d, p_from, ''))) / length(p_from);
  if n <> p_count then raise exception 'patch %: expected % match(es), found %', p_fn, p_count, n; end if;
  execute replace(d, p_from, p_to);
end $$;

-- 1. The fetcher re-checks rejected clips too.
select pg_temp.cx_patch('public.clips_due_for_metrics(integer)',
  $a$where s.status = 'approved'$a$,
  $b$where (s.status = 'approved'
         or (s.status = 'rejected'
             and not (s.metrics_status = 'error'
                      and s.metrics_fetched_at > greatest(s.reviewed_at, timestamptz '2026-11-20 00:00+00'))))$b$, 1);
select pg_temp.cx_patch('public.clips_due_on_open(uuid)',
  $a$where s.status = 'approved' and s.metrics_status <> 'unsupported'$a$,
  $b$where (s.status = 'approved'
            or (s.status = 'rejected'
                and not (s.metrics_status = 'error'
                         and s.metrics_fetched_at > greatest(s.reviewed_at, timestamptz '2026-11-20 00:00+00'))))
       and s.metrics_status <> 'unsupported'$b$, 1);

-- 2. campaigns.total_views (views only; budget_used and creators_count unchanged).
select pg_temp.cx_patch('public.sync_campaign_stats_on_submission()',
  $a$coalesce(sum(case when status='approved' then views_count else 0 end), 0),$a$,
  $b$coalesce(sum(case when status='approved'
                         or public.cx_rejected_live(status, metrics_status, metrics_fetched_at, reviewed_at)
                    then views_count else 0 end), 0),$b$, 1);

-- 3. Campaign stats: view sums only (approved counts, total_paid, earnings unchanged).
select pg_temp.cx_patch('public.cx_campaign_stats(text)',
  $a$SUM(cs.views_count) FILTER (WHERE cs.status = 'approved'$a$,
  $b$SUM(cs.views_count) FILTER (WHERE (cs.status = 'approved' or public.cx_rejected_live(cs.status, cs.metrics_status, cs.metrics_fetched_at, cs.reviewed_at))$b$, 3);
select pg_temp.cx_patch('public.cx_campaign_stats(text)',
  $a$SUM(cs.views_count) FILTER (WHERE cs.status='approved'$a$,
  $b$SUM(cs.views_count) FILTER (WHERE (cs.status='approved' or public.cx_rejected_live(cs.status, cs.metrics_status, cs.metrics_fetched_at, cs.reviewed_at))$b$, 7);

-- 4. Client PIN report: total, per-day and per-platform views.
select pg_temp.cx_patch('public.client_campaign_report(text,text)',
  $a$sum(COALESCE(views_count, views, 0)) FILTER (WHERE status = 'approved')$a$,
  $b$sum(COALESCE(views_count, views, 0)) FILTER (WHERE status = 'approved' or public.cx_rejected_live(status, metrics_status, metrics_fetched_at, reviewed_at))$b$, 3);

-- 5. Client portal: views-only list (no money, no link) next to the clip rows.
select pg_temp.cx_patch('public.client_dashboard_data()',
  $a$    'fx', public.cx_fx_rates_public(),$a$,
  $b$    'views_extra', coalesce((
      select jsonb_agg(jsonb_build_object(
               'campaign_id', s.campaign_id, 'platform', s.platform, 'handle', s.handle,
               'views', s.views_count, 'created_at', s.created_at))
      from public.clip_submissions s
      join public.campaigns c on c.id::text = s.campaign_id
      where public.cx_rejected_live(s.status, s.metrics_status, s.metrics_fetched_at, s.reviewed_at)
        and (exists (select 1 from public.campaign_clients cc
                      where cc.campaign_id = c.id and cc.client_user_id = uid)
             or c.client_user_id = uid)), '[]'::jsonb),

    'fx', public.cx_fx_rates_public(),$b$, 1);

-- 6. Console: creators list and creator profile views.
select pg_temp.cx_patch('public.admin_list_creators(text,uuid,text,text,text,text,integer,text,integer,integer)',
  $a$sum(s.views_count) filter (where s.status = 'approved')$a$,
  $b$sum(s.views_count) filter (where s.status = 'approved' or public.cx_rejected_live(s.status, s.metrics_status, s.metrics_fetched_at, s.reviewed_at))$b$, 2);
select pg_temp.cx_patch('public.admin_creator_detail(uuid)',
  $a$where s2.user_id = p.id and s2.campaign_id = c.id::text and s2.status = 'approved'), 0),$a$,
  $b$where s2.user_id = p.id and s2.campaign_id = c.id::text
                                and (s2.status = 'approved' or public.cx_rejected_live(s2.status, s2.metrics_status, s2.metrics_fetched_at, s2.reviewed_at))), 0),$b$, 1);

-- 7. Console overview "Views delivered".
do $v$
declare d text; f text := $a$WHERE (clip_submissions.status = 'approved'::text)) AS total_approved_views$a$;
begin
  d := pg_get_viewdef('public.v_admin_kpis'::regclass);
  if position(f in d) = 0 then raise exception 'v_admin_kpis: pattern not found'; end if;
  execute 'create or replace view public.v_admin_kpis as ' || replace(d, f,
    $b$WHERE (clip_submissions.status = 'approved'::text OR public.cx_rejected_live(clip_submissions.status, clip_submissions.metrics_status, clip_submissions.metrics_fetched_at, clip_submissions.reviewed_at))) AS total_approved_views$b$);
end $v$;

commit;
