-- 037: appeals (a chat on a rejected clip between its creator and the campaign's
-- client, supervised by Clipency) and support requests (a chat with the Clipency team).
--
-- Matches what clipency-appeals.js expects:
--   appeal_list(), appeal_unread(), appeal_thread(id), appeal_open(submission, body),
--   appeal_post(id, body, image_url), appeal_resolve(id, outcome), support_open(body, subject),
--   appeal_outbox_count()
--
-- Rules (same as the offline demo and the UI):
-- * No contact details or outside chat anywhere (emails, phone numbers, other apps,
--   outside links). Between creators and clients, no payment talk either. Support
--   chats and Clipency's own posts may talk about payouts.
-- * Appeals are not archived: when one is settled the thread and all its messages are
--   deleted for good. If its clip gets approved some other way, the appeal disappears
--   at once and the hourly sweep (039) deletes it.
-- * Add-only: new tables and functions. Nothing is attached to existing tables. The one
--   existing-data write (approved by the owner): "Approve clip" in an appeal turns that
--   one rejected clip into approved, exactly like an approval from the review queue.
-- * Every message emails the other side. Emails go into cx_message_outbox, which the
--   message-emails edge function sends (039 schedules it). The existing review
--   email pipeline (email_outbox, 023/024) is not touched.
-- * Tables are readable through row-level security so Supabase Realtime can push
--   new messages live; all writes go through the functions below.
--
-- Safe to re-run.

begin;

-- ---------- tables ----------
create table if not exists public.appeals (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'clip' check (kind in ('clip','support')),
  submission_id uuid unique references public.clip_submissions(id) on delete cascade,
  campaign_id uuid,
  creator_id uuid not null,                     -- the creator (clip) or whoever opened the support request
  requester_role text,                          -- support: 'creator' | 'client'
  subject text,
  creator_handle text, platform text, clip_url text, reject_reason text,
  status text not null default 'open' check (status in ('open','closed')),
  outcome text check (outcome in ('approved','upheld','resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  check ((kind = 'clip') = (submission_id is not null))
);
create index if not exists idx_appeals_creator on public.appeals (creator_id);
create index if not exists idx_appeals_campaign on public.appeals (campaign_id);

create table if not exists public.appeal_messages (
  id uuid primary key default gen_random_uuid(),
  appeal_id uuid not null references public.appeals(id) on delete cascade,
  sender_id uuid,
  sender_role text not null check (sender_role in ('creator','client','admin','system')),
  sender_name text,
  body text not null default '',
  image_url text,
  created_at timestamptz not null default clock_timestamp()   -- clock time: several messages in one call keep their order
);
alter table public.appeal_messages alter column created_at set default clock_timestamp();
create index if not exists idx_appeal_messages_thread on public.appeal_messages (appeal_id, created_at);

create table if not exists public.appeal_reads (
  appeal_id uuid not null references public.appeals(id) on delete cascade,
  user_id uuid not null,
  seen_at timestamptz not null default now(),
  primary key (appeal_id, user_id)
);

-- emails from chats (appeals, support, group chats). One row per person per thread
-- while unsent: more messages update it instead of sending another email.
create table if not exists public.cx_message_outbox (
  id bigserial primary key,
  to_email text not null,
  subject text not null,
  body text not null default '',
  template text not null default 'appeal-message',
  ref_id uuid,
  messages int not null default 1,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','skipped')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index if not exists uq_cx_message_outbox_pending on public.cx_message_outbox (lower(to_email), ref_id) where status = 'queued';
create index if not exists idx_cx_message_outbox_queue on public.cx_message_outbox (status, created_at);
alter table public.cx_message_outbox enable row level security;
revoke all on public.cx_message_outbox from anon, authenticated;

-- ---------- helpers ----------
-- what a chat message isn't allowed to contain ('' = fine). Same rules as the UI.
create or replace function public.cx_chat_violation(p_text text, p_allow_money boolean default false) returns text
language plpgsql immutable as $f$
declare t text := coalesce(p_text, '');
begin
  if t ~ '[\w.+-]+@[\w-]+\.[\w.-]+' then return 'email addresses'; end if;
  if t ~ '(?:\+?\d[\s().-]?){8,}' then return 'phone numbers'; end if;
  if t ~* '\y(whats\s?app|telegram|signal app|snap\s?chat|wechat|discord(?:\.gg)?|wa\.me|t\.me|skype)\y' then return 'other chat apps'; end if;
  if t ~* '\y(dm me|text me|call me|my number|phone number|contact me (?:on|at)|message me on|reach me (?:on|at))\y' then return 'requests to talk privately'; end if;
  if t ~* 'https?://(?!(?:www\.)?(?:instagram\.com|instagr\.am|tiktok\.com|vm\.tiktok\.com|youtube\.com|youtu\.be|clipency\.in)\y)\S+' then
    return 'outside links (only Instagram, TikTok and YouTube links are allowed)';
  end if;
  if not p_allow_money and t ~* ('[$₹€£¥]|\y(rs\.?|inr|usd|eur|gbp|rupees?|dollars?|euros?|pounds?|bucks|paisa|lakhs?|lacs?|crores?|pay|paid|pays|paying|payment|payments|payout|payouts|money|cash|price|prices|pricing|rate|rates|rpm|cpm|fee|fees|salary|earn|earns|earned|earning|earnings|budget|budgets|invoice|invoices|upi|paypal|bank|transfer|tip|tips|bonus|bonuses|commission|compensation|per view|per video|per reel|per clip)\y') then
    return 'payment or money talk (amounts, currencies, rates or payouts)';
  end if;
  return '';
end $f$;

create or replace function public.cx_email_of(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(p.email), ''), u.email)
    from (select p_user as id) x left join public.profiles p on p.id = x.id left join auth.users u on u.id = x.id
$$;

-- queue an email (merges into an unsent one for the same person + thread)
create or replace function public.cx_queue_message_email(p_to text, p_subject text, p_body text, p_template text, p_ref uuid) returns void
language plpgsql security definer set search_path = public as $f$
begin
  if p_to is null or btrim(p_to) = '' then return; end if;
  insert into public.cx_message_outbox (to_email, subject, body, template, ref_id)
  values (btrim(p_to), p_subject, left(coalesce(p_body, ''), 500), p_template, p_ref)
  on conflict (lower(to_email), ref_id) where status = 'queued'
  do update set subject = excluded.subject, body = excluded.body, messages = cx_message_outbox.messages + 1, updated_at = now();
end $f$;

-- the Clipency team (admin_users, the same list cx_is_admin() reads)
create or replace function public.cx_admin_emails() returns setof text
language sql stable security definer set search_path = public as $$
  select distinct e from (select coalesce(nullif(btrim(a.email), ''), public.cx_email_of(a.user_id)) e from public.admin_users a) x where e is not null
$$;

-- the caller's side in a thread
create or replace function public.cx_appeal_role() returns text
language sql stable security definer set search_path = public as $$
  select case when public.cx_is_staff() then 'admin' when public.cx_is_client() then 'client' else 'creator' end
$$;

-- a clip appeal only exists while its clip is rejected/flagged: once the clip is approved
-- anywhere, it disappears here at once and the hourly sweep (039) deletes it for good
create or replace function public.cx_appeal_visible(p_appeal uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.appeals a where a.id = p_appeal
                   and (a.kind = 'support' or exists (select 1 from public.clip_submissions s
                                                       where s.id = a.submission_id and s.status in ('rejected','flagged')))
                   and (a.creator_id = auth.uid() or public.cx_is_staff()
                        or (a.kind = 'clip' and public.cx_is_campaign_client(a.campaign_id))))
$$;

create or replace function public.cx_appeal_unread(p_appeal uuid, p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.appeal_messages m
   where m.appeal_id = p_appeal and m.sender_role <> 'system' and m.sender_id is distinct from p_user
     and m.created_at > coalesce((select r.seen_at from public.appeal_reads r where r.appeal_id = p_appeal and r.user_id = p_user), '-infinity')
$$;

create or replace function public.cx_appeal_row(p_appeal uuid, p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', a.id, 'kind', a.kind, 'submission_id', a.submission_id, 'campaign_id', a.campaign_id,
    'requester_role', a.requester_role, 'subject', a.subject,
    'campaign_title', case when a.kind = 'support' then coalesce(a.subject, 'Support request') else c.title end,
    'client_name', case when a.kind = 'support' then 'Clipency team'
                        else coalesce(nullif(btrim(c.brand_name), ''), public.cx_display_name(c.client_user_id)) end,
    'creator_id', a.creator_id, 'creator_name', public.cx_display_name(a.creator_id),
    'creator_email', case when a.kind = 'support' and public.cx_is_staff() then public.cx_email_of(a.creator_id) end,
    'creator_handle', a.creator_handle, 'platform', a.platform, 'clip_url', a.clip_url, 'reject_reason', a.reject_reason,
    'status', a.status, 'outcome', a.outcome, 'created_at', a.created_at, 'last_message_at', a.last_message_at,
    'last_message_preview', case when lm.body <> '' then left(lm.body, 120) when lm.image_url is not null then '[screenshot]' else '' end,
    'last_sender_role', lm.sender_role,
    'message_count', (select count(*) from public.appeal_messages m where m.appeal_id = a.id),
    'unread', public.cx_appeal_unread(a.id, p_user))
  from public.appeals a
  left join public.campaigns c on c.id = a.campaign_id
  left join lateral (select m.body, m.image_url, m.sender_role from public.appeal_messages m
                      where m.appeal_id = a.id order by m.created_at desc, m.id desc limit 1) lm on true
  where a.id = p_appeal
$$;

create or replace function public.cx_appeal_add(p_appeal uuid, p_role text, p_body text, p_image text default null) returns public.appeal_messages
language plpgsql security definer set search_path = public as $f$
declare m public.appeal_messages; uid uuid := auth.uid();
begin
  insert into public.appeal_messages (appeal_id, sender_id, sender_role, sender_name, body, image_url)
  values (p_appeal, case when p_role = 'system' then null else uid end, p_role,
          case p_role when 'system' then 'Clipency' when 'admin' then 'Clipency team' else public.cx_display_name(uid) end,
          coalesce(p_body, ''), p_image)
  returning * into m;
  update public.appeals set last_message_at = m.created_at, updated_at = m.created_at where id = p_appeal;
  if uid is not null and p_role <> 'system' then
    insert into public.appeal_reads (appeal_id, user_id, seen_at) values (p_appeal, uid, m.created_at)
    on conflict (appeal_id, user_id) do update set seen_at = excluded.seen_at;
  end if;
  return m;
end $f$;

-- email the other side(s) of a thread
create or replace function public.cx_appeal_notify(p_appeal uuid, p_from text, p_preview text) returns void
language plpgsql security definer set search_path = public as $f$
declare a record; c record; subj text; e text;
begin
  select * into a from public.appeals where id = p_appeal;
  if not found then return; end if;
  if a.kind = 'support' then
    if p_from = 'admin' then
      perform public.cx_queue_message_email(public.cx_email_of(a.creator_id), 'Clipency support replied to your request', p_preview, 'support-reply', a.id);
    else
      for e in select * from public.cx_admin_emails() loop
        perform public.cx_queue_message_email(e, 'Support request from ' || public.cx_display_name(a.creator_id) || ' (' || coalesce(a.requester_role, 'user') || ')',
                                              p_preview, 'support-request', a.id);
      end loop;
    end if;
    return;
  end if;
  select * into c from public.campaigns where id = a.campaign_id;
  subj := 'New message on the appeal for ' || coalesce(a.creator_handle, 'a clip') || ' (' || coalesce(c.title, 'campaign') || ')';
  if p_from <> 'client' then
    for e in select distinct public.cx_email_of(x.uid) from (select c.client_user_id as uid union select cc.client_user_id from public.campaign_clients cc where cc.campaign_id = c.id) x
             where x.uid is not null loop
      perform public.cx_queue_message_email(e, subj, p_preview, 'appeal-message', a.id);
    end loop;
  end if;
  if p_from <> 'creator' then perform public.cx_queue_message_email(public.cx_email_of(a.creator_id), subj, p_preview, 'appeal-message', a.id); end if;
end $f$;

create or replace function public.cx_chat_text(p_body text, p_allow_money boolean) returns text
language plpgsql immutable as $f$
declare b text := btrim(coalesce(p_body, '')); bad text;
begin
  if length(b) > 4000 then raise exception 'Message is too long (4000 characters max)'; end if;
  bad := public.cx_chat_violation(b, p_allow_money);
  if bad <> '' then
    raise exception 'Appeals can’t include %', bad || case when bad like 'payment%' then '. Payment questions go to Clipency through Support.'
                                                           else '. Keep the conversation here, on Clipency.' end;
  end if;
  return b;
end $f$;

-- screenshots must come from Clipency's own storage bucket
create or replace function public.cx_chat_image_ok(p_url text, p_bucket text) returns boolean language sql immutable as $$
  select p_url is null or p_url ~ ('^https://[a-z0-9.-]+/storage/v1/object/public/' || p_bucket || '/[A-Za-z0-9/_.-]+$')
$$;

-- ---------- RPCs ----------
create or replace function public.appeal_list() returns jsonb
language plpgsql stable security definer set search_path = public as $f$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  return coalesce((select jsonb_agg(public.cx_appeal_row(a.id, uid) order by a.last_message_at desc)
                     from public.appeals a where public.cx_appeal_visible(a.id)), '[]'::jsonb);
end $f$;

create or replace function public.appeal_unread() returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(public.cx_appeal_unread(a.id, auth.uid())), 0)::int
    from public.appeals a where auth.uid() is not null and public.cx_appeal_visible(a.id)
$$;

create or replace function public.appeal_thread(p_appeal_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $f$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.cx_appeal_visible(p_appeal_id) then raise exception 'Appeal not found'; end if;
  insert into public.appeal_reads (appeal_id, user_id, seen_at) values (p_appeal_id, uid, clock_timestamp())
  on conflict (appeal_id, user_id) do update set seen_at = clock_timestamp();
  return jsonb_build_object(
    'appeal', public.cx_appeal_row(p_appeal_id, uid),
    'messages', coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object('mine', coalesce(m.sender_id = uid, false)) order by m.created_at, m.id)
                            from public.appeal_messages m where m.appeal_id = p_appeal_id), '[]'::jsonb));
end $f$;

-- the creator opens (or re-opens) the appeal for one of their rejected clips
create or replace function public.appeal_open(p_submission_id uuid, p_body text default '') returns jsonb
language plpgsql security definer set search_path = public as $f$
declare uid uuid := auth.uid(); s record; a public.appeals; body text; existed boolean; camp record; e text;
begin
  select * into s from public.clip_submissions where id = p_submission_id;
  if not found or s.user_id is distinct from uid then raise exception 'You can only appeal your own clips'; end if;
  if s.status not in ('rejected','flagged') then raise exception 'Only rejected clips can be appealed'; end if;
  body := public.cx_chat_text(p_body, false);

  select * into a from public.appeals where submission_id = s.id for update;
  existed := found;
  if not existed then
    insert into public.appeals (kind, submission_id, campaign_id, creator_id, creator_handle, platform, clip_url, reject_reason)
    values ('clip', s.id, case when s.campaign_id ~* '^[0-9a-f-]{36}$' then s.campaign_id::uuid end, uid, s.handle, s.platform, s.clip_url, s.rejection_reason)
    returning * into a;
    perform public.cx_appeal_add(a.id, 'system', 'Appeal opened for this clip. The client has been notified by email.');
  elsif a.status <> 'open' then
    update public.appeals set status = 'open', outcome = null, updated_at = now() where id = a.id;
    perform public.cx_appeal_add(a.id, 'system', 'The creator re-opened this appeal.');
  end if;
  if body <> '' then perform public.cx_appeal_add(a.id, 'creator', body); end if;
  perform public.cx_appeal_notify(a.id, 'creator', coalesce(nullif(body, ''), 'A creator opened an appeal.'));
  if not existed then
    select * into camp from public.campaigns where id = a.campaign_id;
    for e in select * from public.cx_admin_emails() loop
      perform public.cx_queue_message_email(e, 'New appeal from ' || public.cx_display_name(uid) || ' (' || coalesce(camp.title, 'campaign') || ')',
                                            coalesce(nullif(body, ''), 'Appeal opened.'), 'appeal-new', a.id);
    end loop;
  end if;
  return jsonb_build_object('id', a.id, 'existing', existed);
end $f$;

create or replace function public.appeal_post(p_appeal_id uuid, p_body text default '', p_image_url text default null) returns jsonb
language plpgsql security definer set search_path = public as $f$
declare a record; r text := public.cx_appeal_role(); body text; m public.appeal_messages;
begin
  if auth.uid() is null or not public.cx_appeal_visible(p_appeal_id) then raise exception 'Appeal not found'; end if;
  select * into a from public.appeals where id = p_appeal_id;
  if a.status <> 'open' and r <> 'admin' then raise exception 'This appeal is closed'; end if;
  -- a client posting in a support request they opened is the 'client' side; in someone else's clip appeal too
  if r = 'client' and a.kind = 'clip' and not public.cx_is_campaign_client(a.campaign_id) then raise exception 'Appeal not found'; end if;
  body := public.cx_chat_text(p_body, a.kind = 'support' or r = 'admin');
  if not public.cx_chat_image_ok(p_image_url, 'appeal-attachments') then raise exception 'Screenshots must be uploaded from the dashboard'; end if;
  if body = '' and p_image_url is null then raise exception 'Write a message or attach a screenshot'; end if;
  m := public.cx_appeal_add(a.id, r, body, p_image_url);
  perform public.cx_appeal_notify(a.id, r, coalesce(nullif(body, ''), 'Sent a screenshot.'));
  return to_jsonb(m) || jsonb_build_object('mine', true);
end $f$;

-- the client (or Clipency) settles a clip appeal; Clipency closes support requests.
-- Either way the conversation is deleted for good.
create or replace function public.appeal_resolve(p_appeal_id uuid, p_outcome text) returns jsonb
language plpgsql security definer set search_path = public as $f$
declare uid uuid := auth.uid(); a record; r text := public.cx_appeal_role(); out text; now_status text;
begin
  select * into a from public.appeals where id = p_appeal_id for update;
  if found and a.kind = 'support' then
    if r <> 'admin' then raise exception 'Only Clipency can close a support request'; end if;
    if a.status <> 'open' then raise exception 'This request is already closed'; end if;
    perform public.cx_queue_message_email(public.cx_email_of(a.creator_id), 'Your Clipency support request was resolved',
                                          'Your support request was marked as resolved. The conversation has been deleted.', 'support-reply', a.id);
    delete from public.appeals where id = a.id;
    return jsonb_build_object('ok', true, 'outcome', 'resolved', 'deleted', true);
  end if;
  if not found or not public.cx_appeal_visible(p_appeal_id) or r = 'creator' then raise exception 'Only the client or Clipency can close an appeal'; end if;
  if r = 'client' and not public.cx_is_campaign_client(a.campaign_id) then raise exception 'Only the client or Clipency can close an appeal'; end if;
  if a.status <> 'open' then raise exception 'This appeal is already closed'; end if;
  out := case when p_outcome = 'approved' then 'approved' else 'upheld' end;

  perform public.cx_appeal_notify(a.id, r, 'The appeal was settled: ' || case when out = 'approved' then 'clip approved.' else 'rejection kept.' end
                                            || ' The conversation has been deleted.');
  if out = 'approved' then
    perform set_config('clipency.trusted_write', '1', true);
    update public.clip_submissions
       set status = 'approved', earning_status = 'approved', rejection_reason = null,
           review_source = case when r = 'client' then 'client' else null end,
           reviewed_by = uid, reviewed_at = now(), updated_at = now()
     where id = a.submission_id and status in ('rejected','flagged');
    perform set_config('clipency.trusted_write', '0', true);
    select status into now_status from public.clip_submissions where id = a.submission_id;
    if now_status is distinct from 'approved' then raise exception 'the clip could not be approved (status is still %)', now_status; end if;
  end if;
  delete from public.appeals where id = a.id;
  return jsonb_build_object('ok', true, 'outcome', out, 'deleted', true);
end $f$;

-- Support → Appeal: a request straight to the Clipency team, from a creator or a client
create or replace function public.support_open(p_body text, p_subject text default '') returns jsonb
language plpgsql security definer set search_path = public as $f$
declare uid uuid := auth.uid(); r text := public.cx_appeal_role(); body text; a public.appeals;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  body := public.cx_chat_text(p_body, true);
  if body = '' then raise exception 'Write your question first'; end if;
  if (select count(*) from public.appeals x where x.kind = 'support' and x.creator_id = uid and x.status = 'open') >= 10 then
    raise exception 'You have 10 open requests already. The team will get back to you soon.';
  end if;
  insert into public.appeals (kind, creator_id, requester_role, subject)
  values ('support', uid, case when r = 'admin' then 'creator' else r end, left(coalesce(nullif(btrim(p_subject), ''), left(body, 60)), 120))
  returning * into a;
  perform public.cx_appeal_add(a.id, 'system', 'Support request sent. The Clipency team has been notified by email and usually replies within a few hours.');
  perform public.cx_appeal_add(a.id, case when r = 'admin' then 'creator' else r end, body);
  perform public.cx_appeal_notify(a.id, r, body);
  return jsonb_build_object('id', a.id);
end $f$;

create or replace function public.appeal_outbox_count() returns int
language sql stable security definer set search_path = public as $$
  select case when public.cx_is_staff() then (select count(*)::int from public.cx_message_outbox where status = 'queued') else 0 end
$$;

-- ---------- row-level security (reads only; Realtime uses these) ----------
alter table public.appeals enable row level security;
alter table public.appeal_messages enable row level security;
alter table public.appeal_reads enable row level security;
revoke all on public.appeals, public.appeal_messages, public.appeal_reads from anon, authenticated;
grant select on public.appeals, public.appeal_messages to authenticated;

drop policy if exists appeals_read on public.appeals;
create policy appeals_read on public.appeals for select to authenticated using (public.cx_appeal_visible(id));
drop policy if exists appeal_messages_read on public.appeal_messages;
create policy appeal_messages_read on public.appeal_messages for select to authenticated using (public.cx_appeal_visible(appeal_id));

-- ---------- grants ----------
revoke all on function public.cx_chat_violation(text, boolean), public.cx_email_of(uuid), public.cx_queue_message_email(text, text, text, text, uuid),
  public.cx_admin_emails(), public.cx_appeal_role(), public.cx_appeal_visible(uuid), public.cx_appeal_unread(uuid, uuid),
  public.cx_appeal_row(uuid, uuid), public.cx_appeal_add(uuid, text, text, text), public.cx_appeal_notify(uuid, text, text),
  public.cx_chat_text(text, boolean), public.cx_chat_image_ok(text, text) from public, anon, authenticated;
grant execute on function public.cx_appeal_visible(uuid), public.cx_chat_violation(text, boolean) to authenticated;   -- RLS policies call it
revoke all on function public.appeal_list(), public.appeal_unread(), public.appeal_thread(uuid), public.appeal_open(uuid, text),
  public.appeal_post(uuid, text, text), public.appeal_resolve(uuid, text), public.support_open(text, text), public.appeal_outbox_count() from public, anon;
grant execute on function public.appeal_list(), public.appeal_unread(), public.appeal_thread(uuid), public.appeal_open(uuid, text),
  public.appeal_post(uuid, text, text), public.appeal_resolve(uuid, text), public.support_open(text, text), public.appeal_outbox_count() to authenticated;

commit;
