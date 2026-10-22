-- 040: welcome every new website inquiry (public.leads) with an email from Tanish and,
-- once the WhatsApp Business Platform is connected, a WhatsApp message.
--
-- Add-only. public.leads and submit_landing_lead are not changed: a 5-minute job looks
-- for new leads and the lead-welcome edge function sends. Only leads created after
-- this is installed are messaged (the 42+ earlier inquiries are left alone).
--
--   cx_lead_outreach          one row per lead we've handled: email + WhatsApp status
--   cx_lead_outreach_config   when outreach started (leads before that are skipped)
--   cx_lead_outreach_due()    service role: leads still to welcome
--   cx_lead_outreach_mark()   service role: record what happened
--   job cx_lead_welcome       every 5 minutes, only wakes the function when there's work
--
-- Safe to re-run.

begin;

create table if not exists public.cx_lead_outreach_config (
  id boolean primary key default true check (id),
  started_at timestamptz not null default now()
);
insert into public.cx_lead_outreach_config (id) values (true) on conflict (id) do nothing;

create table if not exists public.cx_lead_outreach (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  email_status text not null default 'pending' check (email_status in ('pending','sent','failed','skipped')),
  email_at timestamptz,
  email_error text,
  wa_status text not null default 'pending' check (wa_status in ('pending','sent','failed','skipped')),
  wa_at timestamptz,
  wa_error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.cx_lead_outreach enable row level security;
alter table public.cx_lead_outreach_config enable row level security;
revoke all on public.cx_lead_outreach, public.cx_lead_outreach_config from anon, authenticated;
-- staff can see who was welcomed (console)
grant select on public.cx_lead_outreach to authenticated;
drop policy if exists cx_lead_outreach_staff on public.cx_lead_outreach;
create policy cx_lead_outreach_staff on public.cx_lead_outreach for select to authenticated using (public.cx_is_staff());

-- leads still to welcome: new since start, not done yet, at most 3 tries.
-- WhatsApp is only attempted within 48 hours of the inquiry (after that it would feel odd).
create or replace function public.cx_lead_outreach_due(p_limit int default 25) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'lead_id', l.id, 'name', l.full_name, 'email', l.email, 'phone', l.phone, 'company', coalesce(l.company, l.brand_name),
           'whatsapp_ok', coalesce((l.raw_payload->>'whatsapp_ok')::boolean, l.phone is not null),
           'email_status', coalesce(o.email_status, 'pending'), 'wa_status', coalesce(o.wa_status, 'pending'),
           'wa_window', l.created_at > now() - interval '48 hours') order by l.created_at), '[]'::jsonb)
    from public.leads l
    left join public.cx_lead_outreach o on o.lead_id = l.id
   where l.created_at >= (select started_at from public.cx_lead_outreach_config)
     and coalesce(o.attempts, 0) < 3
     and (coalesce(o.email_status, 'pending') = 'pending' or coalesce(o.wa_status, 'pending') = 'pending')
   limit p_limit
$$;

create or replace function public.cx_lead_outreach_mark(p_lead uuid, p_channel text, p_status text, p_error text default null) returns void
language plpgsql security definer set search_path = public as $f$
begin
  if p_channel not in ('email','whatsapp') or p_status not in ('pending','sent','failed','skipped') then raise exception 'bad mark'; end if;
  insert into public.cx_lead_outreach (lead_id) values (p_lead) on conflict (lead_id) do nothing;
  if p_channel = 'email' then
    update public.cx_lead_outreach set email_status = p_status, email_at = case when p_status = 'sent' then now() else email_at end,
           email_error = left(p_error, 300), attempts = attempts + case when p_status = 'failed' then 1 else 0 end, updated_at = now()
     where lead_id = p_lead;
  else
    update public.cx_lead_outreach set wa_status = p_status, wa_at = case when p_status = 'sent' then now() else wa_at end,
           wa_error = left(p_error, 300), attempts = attempts + case when p_status = 'failed' then 1 else 0 end, updated_at = now()
     where lead_id = p_lead;
  end if;
end $f$;

create or replace function public.cx_lead_welcome_kick() returns bigint
language plpgsql security definer set search_path = public as $f$
begin
  if public.cx_lead_outreach_due(1) = '[]'::jsonb then return null; end if;
  return public.cx_edge_kick('lead-welcome', jsonb_build_object('mode', 'send'));
end $f$;

revoke all on function public.cx_lead_outreach_due(int), public.cx_lead_outreach_mark(uuid, text, text, text), public.cx_lead_welcome_kick()
  from public, anon, authenticated;
grant execute on function public.cx_lead_outreach_due(int), public.cx_lead_outreach_mark(uuid, text, text, text) to service_role;

do $cron$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'cx_lead_welcome';
  perform cron.schedule('cx_lead_welcome', '*/5 * * * *', 'select public.cx_lead_welcome_kick();');
end $cron$;

commit;
