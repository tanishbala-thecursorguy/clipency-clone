-- 028_metrics_until_campaign_ends.sql
-- View tracking no longer stops at day 14. An approved clip is fetched
-- twice a day for its first 3 days, then once a day for as long as its
-- campaign is active. Pausing or ending the campaign stops it.
--
-- The thresholds are 10 minutes under 12h / 24h so the hourly cron lands on
-- the 12th / 24th hour instead of drifting to 13h / 25h.

create or replace function public.clips_due_for_metrics(p_limit integer default 200)
returns table(id uuid, clip_url text, metrics_fetched_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.clip_url, s.metrics_fetched_at
  from public.clip_submissions s
  join public.campaigns c on c.id::text = s.campaign_id
  where s.status = 'approved'
    and s.metrics_status <> 'unsupported'
    and s.clip_url is not null
    and c.status = 'active'
    and (
      s.metrics_fetched_at is null
      or s.metrics_fetched_at < now() - case when now() - s.created_at < interval '3 days'
                                             then interval '11 hours 50 minutes'
                                             else interval '23 hours 50 minutes' end
    )
  order by s.metrics_fetched_at asc nulls first, s.created_at desc
  limit greatest(1, least(p_limit, 500));
$$;

create or replace function public.clip_metrics_eligible(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.clip_submissions s
    join public.campaigns c on c.id::text = s.campaign_id
    where s.id = p_id
      and s.status = 'approved'
      and c.status = 'active'
      and (coalesce(c.budget, 0) = 0
           or coalesce(c.budget_used, 0) < public.campaign_creator_pool(c))
  );
$$;
