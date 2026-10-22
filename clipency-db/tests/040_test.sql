-- Behaviour tests for 040 (lead welcome queue). Local only. Rolled back.
\set ON_ERROR_STOP 1
begin;
insert into vault.decrypted_secrets values ('service_role_key', 'test-key') on conflict do nothing;
-- an old lead (before outreach started) and two new ones
insert into public.leads (full_name, email, created_at) values ('Old Lead', 'old@x.test', now() - interval '30 days');
update public.cx_lead_outreach_config set started_at = now() - interval '1 day';
insert into public.leads (id, full_name, email, phone, company, raw_payload) values
  ('99999999-0000-0000-0000-000000000001', 'Asha Rao', 'asha@x.test', '+91 98765 43210', 'Acme', '{"whatsapp_ok": true}'),
  ('99999999-0000-0000-0000-000000000002', 'Ben Lee', 'ben@x.test', null, 'Beta', '{"whatsapp_ok": false}');
do $$ declare d jsonb; n0 int; begin
  d := public.cx_lead_outreach_due();
  if jsonb_array_length(d) <> 2 or d::text like '%old@x.test%' then raise exception 'FAIL: due %', d; end if;
  if not (d->0->>'whatsapp_ok')::boolean or (d->1->>'whatsapp_ok')::boolean then raise exception 'FAIL: consent flags %', d; end if;
  select count(*) into n0 from net.calls;
  perform public.cx_lead_welcome_kick();
  if (select count(*) from net.calls) <> n0 + 1 or (select url from net.calls order by id desc limit 1) not like '%/functions/v1/lead-welcome' then raise exception 'FAIL: kick'; end if;
  -- Asha: both sent; Ben: email sent, WhatsApp skipped -> nothing left to do
  perform public.cx_lead_outreach_mark('99999999-0000-0000-0000-000000000001', 'email', 'sent');
  perform public.cx_lead_outreach_mark('99999999-0000-0000-0000-000000000001', 'whatsapp', 'sent');
  perform public.cx_lead_outreach_mark('99999999-0000-0000-0000-000000000002', 'email', 'sent');
  perform public.cx_lead_outreach_mark('99999999-0000-0000-0000-000000000002', 'whatsapp', 'skipped', 'no phone');
  if jsonb_array_length(public.cx_lead_outreach_due()) <> 0 then raise exception 'FAIL: still due after sending'; end if;
  select count(*) into n0 from net.calls;
  perform public.cx_lead_welcome_kick();
  if (select count(*) from net.calls) <> n0 then raise exception 'FAIL: woke the function with nothing to do'; end if;
  raise notice 'PASS 040: only new leads, consent respected, each handled once, quiet when idle';
end $$;
-- failing three times stops retries
insert into public.leads (id, full_name, email) values ('99999999-0000-0000-0000-000000000003', 'Cara', 'bounce@x.test');
do $$ begin
  perform public.cx_lead_outreach_mark('99999999-0000-0000-0000-000000000003', 'email', 'failed', 'x');
  perform public.cx_lead_outreach_mark('99999999-0000-0000-0000-000000000003', 'email', 'pending');
  perform public.cx_lead_outreach_mark('99999999-0000-0000-0000-000000000003', 'email', 'failed', 'x');
  perform public.cx_lead_outreach_mark('99999999-0000-0000-0000-000000000003', 'email', 'pending');
  perform public.cx_lead_outreach_mark('99999999-0000-0000-0000-000000000003', 'email', 'failed', 'x');
  perform public.cx_lead_outreach_mark('99999999-0000-0000-0000-000000000003', 'email', 'pending');
  if jsonb_array_length(public.cx_lead_outreach_due()) <> 0 then raise exception 'FAIL: retried forever'; end if;
  raise notice 'PASS 040: gives up after 3 failed tries';
end $$;
-- the browser can't touch the queue
set role authenticated;
do $$ begin
  begin perform public.cx_lead_outreach_due(); raise exception 'FAIL: callable by a user';
  exception when insufficient_privilege then null; end;
  raise notice 'ALL 040 TESTS PASSED';
end $$;
reset role;
rollback;
