-- 065: the console Clip Feed refreshes views as soon as it opens.
--
-- 064 made staff name a campaign, so the console only refreshed after a campaign
-- was picked in the filter; with "All campaigns" nothing was re-read. Now staff
-- with no campaign get every active campaign's top 30 clips plus the last 3 days,
-- oldest-read first, still at most 60 per call and only if 30+ minutes old.
-- Same function and signature, read only.

create or replace function public.clips_due_on_open(p_campaign uuid default null)
returns table (id uuid, clip_url text, metrics_fetched_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare uid uuid := auth.uid(); staff boolean := public.cx_is_staff();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not staff and not public.cx_is_client() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  with camps as (
    select c.id from public.campaigns c
     where c.status = 'active' and not coalesce(c.metrics_paused, false)
       and (p_campaign is null or c.id = p_campaign)
       and (staff or c.client_user_id = uid
            or exists (select 1 from public.campaign_clients cc where cc.campaign_id = c.id and cc.client_user_id = uid))),
  clips as (
    select s.id, s.clip_url, s.metrics_fetched_at, s.created_at,
           row_number() over (partition by s.campaign_id order by s.views_count desc nulls last) rk
      from public.clip_submissions s join camps on camps.id::text = s.campaign_id
     where s.status = 'approved' and s.metrics_status <> 'unsupported' and s.clip_url is not null)
  select clips.id, clips.clip_url, clips.metrics_fetched_at from clips
   where (clips.rk <= 30 or clips.created_at > now() - interval '3 days')
     and (clips.metrics_fetched_at is null or clips.metrics_fetched_at < now() - interval '30 minutes')
   order by clips.metrics_fetched_at asc nulls first
   limit 60;
end $$;
revoke execute on function public.clips_due_on_open(uuid) from public, anon;
grant  execute on function public.clips_due_on_open(uuid) to authenticated;
