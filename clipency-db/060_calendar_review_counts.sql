-- 060: Content Calendar shows where each creator's videos stand in review.
--
-- A video counts toward the plan as soon as it is submitted (unless rejected), so the
-- console could not tell "posted and approved" from "posted, still waiting". The
-- console list now also gets, per plan, how many of the creator's videos for that
-- campaign since the plan started are waiting for approval, approved, and rejected,
-- and when the oldest waiting one came in.
--
-- Only admin_content_calendar() is replaced (same signature, read only, one extra
-- 'review' key). Nothing is written and no table changes.

create or replace function public.admin_content_calendar()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.cx_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(public.cx_cal_state(p.id) || jsonb_build_object(
      'campaign_id', p.campaign_id, 'campaign', c.title, 'user_id', p.user_id, 'label', p.label,
      'done_before', p.done_before, 'email', u.email,
      'name', coalesce(nullif(pr.full_name, ''), split_part(u.email, '@', 1)),
      'review', (select jsonb_build_object(
                   'pending',  count(*) filter (where s.status = 'pending'),
                   'approved', count(*) filter (where s.status = 'approved'),
                   'rejected', count(*) filter (where s.status = 'rejected'),
                   'oldest_pending', min(s.created_at) filter (where s.status = 'pending'))
                   from public.clip_submissions s
                  where s.user_id = p.user_id and s.campaign_id::text = p.campaign_id::text
                    and (s.created_at at time zone 'Asia/Kolkata')::date >= p.start_date),
      'sends', coalesce((select jsonb_agg(jsonb_build_object('kind', s.kind, 'day', s.for_day, 'status', s.status, 'at', coalesce(s.sent_at, s.created_at), 'error', s.error) order by s.created_at desc)
                           from (select * from public.cal_sends s where s.plan_id = p.id order by s.created_at desc limit 8) s), '[]'::jsonb))
      order by c.title, p.style, p.label)
      from public.cal_plans p join public.campaigns c on c.id = p.campaign_id
      join auth.users u on u.id = p.user_id left join public.profiles pr on pr.id = p.user_id), '[]'::jsonb);
end $$;
