-- 040b: the welcome now follows a Calendly booking. The lead saved by the booking form
-- carries raw_payload.booking {event_uri, invitee_uri}; lead-welcome reads it to send the
-- booked time. Only the function from 040 changes. Safe to re-run.
create or replace function public.cx_lead_outreach_due(p_limit int default 25) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'lead_id', l.id, 'name', l.full_name, 'email', l.email, 'phone', l.phone, 'company', coalesce(l.company, l.brand_name),
           'whatsapp_ok', coalesce((l.raw_payload->>'whatsapp_ok')::boolean, l.phone is not null),
           'booking', l.raw_payload->'booking',
           'email_status', coalesce(o.email_status, 'pending'), 'wa_status', coalesce(o.wa_status, 'pending'),
           'wa_window', l.created_at > now() - interval '48 hours') order by l.created_at), '[]'::jsonb)
    from public.leads l
    left join public.cx_lead_outreach o on o.lead_id = l.id
   where l.created_at >= (select started_at from public.cx_lead_outreach_config)
     and coalesce(o.attempts, 0) < 3
     and (coalesce(o.email_status, 'pending') = 'pending' or coalesce(o.wa_status, 'pending') = 'pending')
   limit p_limit
$$;
revoke all on function public.cx_lead_outreach_due(int) from public, anon, authenticated;
grant execute on function public.cx_lead_outreach_due(int) to service_role;
