-- 035: client reviews are capped at 24 hours, and a rejection needs a real reason.
-- Approved by the owner on 2026-10-22. This is the only migration in 035-039 that
-- changes something that already exists:
--
-- * campaigns.client_review_hours: default 24, allowed 1..24 (was default 48, 1..168).
--   The campaigns set above 24 (all 13 at 48 when checked) are set to 24.
-- * client_review_clip(): the live function, unchanged except one rule: rejecting
--   needs a reason of at least 15 characters (was: any non-empty reason).
-- * Clips already waiting for review keep the deadline they were given. Only clips
--   submitted after this runs get the 24-hour window (cx_stamp_review_due reads the
--   campaign's hours when a clip comes in).
--
-- Safe to re-run.

begin;

alter table public.campaigns alter column client_review_hours set default 24;
update public.campaigns set client_review_hours = 24 where client_review_hours > 24;
alter table public.campaigns drop constraint if exists campaigns_client_review_hours_chk;
alter table public.campaigns add constraint campaigns_client_review_hours_chk
  check (client_review_hours between 1 and 24);

create or replace function public.client_review_clip(p_submission_id uuid, p_approve boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare uid uuid := auth.uid(); s record; camp record; now_status text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not cx_is_client() then raise exception 'not a client account'; end if;
  if p_approve is null then raise exception 'approve or reject?'; end if;
  -- 035: a rejection explains itself to the creator (the dashboard asks for 15+ characters)
  if not p_approve and length(coalesce(btrim(p_reason), '')) < 15 then
    raise exception 'Write why you are rejecting this clip (at least 15 characters).';
  end if;
  if length(coalesce(p_reason, '')) > 2000 then raise exception 'reason is too long'; end if;

  select * into s from public.clip_submissions where id = p_submission_id for update;
  if not found then raise exception 'no such clip'; end if;
  select * into camp from public.campaigns c where c.id::text = s.campaign_id;
  if not found then raise exception 'clip is not on a campaign'; end if;
  if not exists (select 1 from public.campaign_clients cc where cc.campaign_id = camp.id and cc.client_user_id = uid)
     and camp.client_user_id is distinct from uid then
    raise exception 'this campaign is not on your dashboard' using errcode = '42501';
  end if;

  if s.status <> 'pending' then
    if (p_approve and s.status = 'approved') or (not p_approve and s.status = 'rejected') then
      return jsonb_build_object('status', s.status, 'already', true, 'source', s.review_source);
    end if;
    raise exception 'this clip was already %', case s.status when 'approved' then 'approved' when 'rejected' then 'rejected' else s.status end;
  end if;
  if not public.cx_client_review_on(s.campaign_id) then
    raise exception 'Clipency reviews the clips on this campaign';
  end if;

  perform set_config('clipency.trusted_write', '1', true);
  if p_approve then
    update public.clip_submissions
       set status = 'approved', earning_status = 'approved', review_source = 'client',
           reviewed_by = uid, reviewed_at = now(), updated_at = now()
     where id = s.id;
  else
    update public.clip_submissions
       set status = 'rejected', earning_status = 'rejected', review_source = 'client',
           rejection_reason = 'Rejected by the client: ' || btrim(p_reason),
           reviewed_by = uid, reviewed_at = now(), updated_at = now()
     where id = s.id;
  end if;
  perform set_config('clipency.trusted_write', '0', true);

  select status into now_status from public.clip_submissions where id = s.id;
  if now_status is distinct from (case when p_approve then 'approved' else 'rejected' end) then
    raise exception 'the clip could not be updated (status is still %)', now_status;
  end if;
  return jsonb_build_object('status', now_status, 'source', 'client');
end $f$;

commit;
