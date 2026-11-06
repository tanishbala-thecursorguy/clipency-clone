-- 064: refresh clip views when someone opens the dashboard.
--
-- Views were only re-read on the schedule (every 12 h for a clip's first 3 days,
-- then daily), so a client could see 14.2K on a reel Instagram already showed at
-- 17.5K. Now, when a client opens their portal (or staff open a campaign in the
-- console Clip Feed), fetch-clip-metrics {mode:"open"} re-reads the clips people
-- actually look at: each campaign's top 30 by views, plus every clip from the last
-- 3 days, if its numbers are more than 30 minutes old. A clip nobody looks at costs
-- nothing extra; the 30-minute floor stops repeat visits from spending credits twice.
--
-- This function only picks the clips (read only). It runs as the caller: a client
-- gets clips of campaigns they own or share (same rule as client_dashboard_data),
-- staff get any campaign but must name one. New function only.

create or replace function public.clips_due_on_open(p_campaign uuid default null)
returns table (id uuid, clip_url text, metrics_fetched_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare uid uuid := auth.uid(); staff boolean := public.cx_is_staff();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if staff and p_campaign is null then return; end if;
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
