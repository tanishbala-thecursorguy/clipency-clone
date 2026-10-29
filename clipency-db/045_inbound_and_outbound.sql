-- 045: Promotions > Outbound shows account emails too; Promotions > Inbound shows replies.
-- APPLIED to live (spwtkdgpgeutrhwcjrpy) on 2026-10-29 with the owner's approval.
--
-- New objects only. client_email_log keeps its current lock-down (no table grant
-- to signed-in users); staff read a summary of it through outbound_account_emails,
-- which returns no payload.
--
-- Inbound: replies to promotions go to <mailbox>@reply.clipency.in, are received by
-- Resend, posted to the inbound-email edge function (signature checked), saved here
-- with inbound_save, and forwarded to the real Gmail mailbox.

begin;

create or replace function public.outbound_account_emails(p_limit int default 500)
returns table (id bigint, to_email text, subject text, kind text, status text, error text, sent_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.cx_is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  return query
    select l.id, l.to_email, l.subject, l.kind, l.status, l.error, l.sent_at, l.created_at
    from client_email_log l order by l.created_at desc limit least(greatest(p_limit, 1), 2000);
end $$;
revoke execute on function public.outbound_account_emails(int) from public, anon;
grant  execute on function public.outbound_account_emails(int) to authenticated;

create table public.inbound_emails (
  id             bigserial primary key,
  resend_id      text unique,
  mailbox        text not null,          -- the team mailbox it was meant for, e.g. jake@clipency.in
  to_address     text,                   -- what the sender actually wrote to (…@reply.clipency.in)
  from_email     text,
  from_name      text,
  subject        text,
  text_body      text,
  html           text,
  promo_id       bigint references public.promo_emails(id) on delete set null,
  spf            text,
  dkim           text,
  dmarc          text,
  forwarded      boolean not null default false,
  forward_error  text,
  read_at        timestamptz,
  received_at    timestamptz not null default now()
);
create index inbound_emails_received on public.inbound_emails (received_at desc);
alter table public.inbound_emails enable row level security;
create policy inbound_emails_staff_read on public.inbound_emails for select to authenticated using (public.cx_is_staff());

-- Edge function only. Links the reply to the promotion that was sent to this
-- person from this mailbox, if there is one.
create or replace function public.inbound_save(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare nid bigint; pid bigint;
begin
  select s.promo_id into pid from promo_sends s
   where s.email = lower(p->>'from_email') and s.from_email = lower(p->>'mailbox')
   order by s.id desc limit 1;
  insert into inbound_emails (resend_id, mailbox, to_address, from_email, from_name, subject, text_body, html, promo_id, spf, dkim, dmarc)
  values (p->>'resend_id', lower(p->>'mailbox'), p->>'to_address', lower(p->>'from_email'), p->>'from_name', p->>'subject',
          p->>'text_body', p->>'html', pid, p->>'spf', p->>'dkim', p->>'dmarc')
  on conflict (resend_id) do nothing
  returning id into nid;
  return nid;
end $$;

create or replace function public.inbound_forwarded(p_id bigint, p_ok boolean, p_error text)
returns void language sql security definer set search_path = public as $$
  update inbound_emails set forwarded = p_ok, forward_error = p_error where id = p_id;
$$;

-- Console: mark a reply as read.
create or replace function public.inbound_mark_read(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.cx_is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  update inbound_emails set read_at = coalesce(read_at, now()) where id = p_id;
end $$;

revoke execute on function public.inbound_save(jsonb)                      from public, anon, authenticated;
revoke execute on function public.inbound_forwarded(bigint, boolean, text) from public, anon, authenticated;
revoke execute on function public.inbound_mark_read(bigint)                from public, anon;
grant  execute on function public.inbound_mark_read(bigint)                to authenticated;

commit;
