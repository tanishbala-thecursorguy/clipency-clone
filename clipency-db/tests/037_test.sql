-- Behaviour tests for 037 (appeals + support). Local only. Rolled back at the end.
\set ON_ERROR_STOP 1
begin;

insert into auth.users values ('00000000-0000-0000-0000-0000000000c1', 'client@x.test'), ('00000000-0000-0000-0000-0000000000c2', 'other@x.test'),
  ('00000000-0000-0000-0000-0000000000a1', 'amy@x.test'), ('00000000-0000-0000-0000-0000000000b1', 'ben@x.test'),
  ('00000000-0000-0000-0000-0000000000ad', 'boss@x.test');
insert into public.profiles (id, email, role, display_name) values
  ('00000000-0000-0000-0000-0000000000c1', 'client@x.test', 'client', 'Acme'),
  ('00000000-0000-0000-0000-0000000000c2', 'other@x.test', 'client', 'Other'),
  ('00000000-0000-0000-0000-0000000000a1', 'amy@x.test', 'clipper', 'Amy'),
  ('00000000-0000-0000-0000-0000000000b1', 'ben@x.test', 'clipper', 'Ben'),
  ('00000000-0000-0000-0000-0000000000ad', 'boss@x.test', 'admin', 'Boss');
insert into public.admin_users (user_id, email) values ('00000000-0000-0000-0000-0000000000ad', 'boss@x.test');
insert into public.campaigns (id, title, brand_name, client_user_id) values
  ('11111111-0000-0000-0000-000000000001', 'Acme launch', 'Acme', '00000000-0000-0000-0000-0000000000c1');
insert into public.clip_submissions (id, user_id, campaign_id, handle, platform, clip_url, status, rejection_reason) values
  ('22222222-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-000000000001', '@amy', 'Instagram', 'https://www.instagram.com/reel/R1/', 'rejected', 'Rejected by the client: wrong audio'),
  ('22222222-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-000000000001', '@amy', 'Instagram', 'https://www.instagram.com/reel/R2/', 'rejected', 'Off brief'),
  ('22222222-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-000000000001', '@amy', 'Instagram', 'https://www.instagram.com/reel/R3/', 'pending', null);

-- the content rules, straight
do $$ declare t text[]; begin
  foreach t slice 1 in array array[
    ['mail me at amy@gmail.com', 'email addresses'], ['call +91 98765 43210', 'phone numbers'], ['ping me on WhatsApp', 'other chat apps'],
    ['just dm me', 'requests to talk privately'], ['see https://drive.google.com/x', 'outside links (only Instagram, TikTok and YouTube links are allowed)'],
    ['what is the rate here', 'payment or money talk (amounts, currencies, rates or payouts)'], ['₹500 please', 'payment or money talk (amounts, currencies, rates or payouts)'],
    ['here https://www.instagram.com/reel/abc/', ''], ['I re-cut the intro, can you look again?', ''], ['the paywall scene', ''], ['grapes are great', '']]
  loop
    if public.cx_chat_violation(t[1]) <> t[2] then raise exception 'FAIL rule: "%" gave "%" not "%"', t[1], public.cx_chat_violation(t[1]), t[2]; end if;
  end loop;
  if public.cx_chat_violation('what is the payout', true) <> '' then raise exception 'FAIL: money allowed in support'; end if;
  raise notice 'PASS 037: contact + money rules match the UI';
end $$;

-- Amy appeals clip 1
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
do $$ declare r jsonb; begin
  begin perform public.appeal_open('22222222-0000-0000-0000-000000000003', 'hi'); raise exception 'FAIL: appealed a pending clip';
  exception when others then if sqlerrm not like 'Only rejected%' then raise; end if; end;
  begin perform public.appeal_open('22222222-0000-0000-0000-000000000001', 'how much do you pay?'); raise exception 'FAIL: money talk allowed';
  exception when others then if sqlerrm not like 'Appeals can’t include payment%' then raise; end if; end;
  r := public.appeal_open('22222222-0000-0000-0000-000000000001', 'I fixed the audio, can you look again?');
  if (r->>'existing')::boolean then raise exception 'FAIL: new appeal said existing'; end if;
  perform set_config('t.appeal', r->>'id', false);
  r := public.appeal_open('22222222-0000-0000-0000-000000000001', '');
  if not (r->>'existing')::boolean then raise exception 'FAIL: second open made another appeal'; end if;
  r := public.appeal_list();
  if jsonb_array_length(r) <> 1 or r->0->>'campaign_title' <> 'Acme launch' or r->0->>'client_name' <> 'Acme' or (r->0->>'unread')::int <> 0 then
    raise exception 'FAIL: creator list %', r; end if;
  raise notice 'PASS 037: creator opens one appeal per clip, rules enforced';
end $$;
reset role;

-- the client sees it with 1 unread, reads it, replies
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
set role authenticated;
do $$ declare r jsonb; id uuid := current_setting('t.appeal')::uuid; begin
  if public.appeal_unread() <> 1 then raise exception 'FAIL: client unread %', public.appeal_unread(); end if;
  r := public.appeal_thread(id);
  if jsonb_array_length(r->'messages') <> 2 or r->'messages'->0->>'sender_role' <> 'system' then raise exception 'FAIL: thread %', r; end if;
  if public.appeal_unread() <> 0 then raise exception 'FAIL: reading did not clear unread'; end if;
  perform public.appeal_post(id, 'Better. Can you also trim the ending?');
  begin perform public.appeal_post(id, 'whatsapp me'); raise exception 'FAIL: chat app allowed';
  exception when others then if sqlerrm not like 'Appeals can’t include other chat apps%' then raise; end if; end;
  begin perform public.appeal_post(id, '', 'https://evil.example/x.jpg'); raise exception 'FAIL: outside image allowed';
  exception when others then if sqlerrm not like 'Screenshots must%' then raise; end if; end;
  perform public.appeal_post(id, '', 'https://abc.supabase.co/storage/v1/object/public/appeal-attachments/x/1.jpg');
  -- direct table reads work through RLS (this is what Realtime uses)
  if (select count(*) from public.appeal_messages) <> 4 then raise exception 'FAIL: client RLS read'; end if;
  begin insert into public.appeal_messages (appeal_id, sender_role, body) values (id, 'admin', 'fake'); raise exception 'FAIL: direct insert allowed';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS 037: client sees, reads, replies; images only from our bucket; no direct writes';
end $$;
reset role;

-- another client and another creator see nothing
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', false);
set role authenticated;
do $$ begin
  if jsonb_array_length(public.appeal_list()) <> 0 or (select count(*) from public.appeal_messages) <> 0 or (select count(*) from public.appeals) <> 0 then
    raise exception 'FAIL: other client can see the appeal'; end if;
  begin perform public.appeal_thread(current_setting('t.appeal')::uuid); raise exception 'FAIL: other client opened thread';
  exception when others then if sqlerrm <> 'Appeal not found' then raise; end if; end;
  begin perform public.appeal_resolve(current_setting('t.appeal')::uuid, 'approved'); raise exception 'FAIL: other client resolved';
  exception when others then if sqlerrm not like 'Only the client%' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
do $$ begin
  if jsonb_array_length(public.appeal_list()) <> 0 or (select count(*) from public.appeal_messages) <> 0 then raise exception 'FAIL: Ben can see Amy''s appeal'; end if;
  raise notice 'PASS 037: outsiders see nothing, through RPCs or RLS';
end $$;
reset role;

-- emails: client got 1 (merged), Amy got 1 (merged x2), admin got the "new appeal"
do $$ begin
  if (select messages from public.cx_message_outbox where to_email = 'amy@x.test') <> 2 then raise exception 'FAIL: creator emails not merged'; end if;
  if not exists (select 1 from public.cx_message_outbox where to_email = 'client@x.test') then raise exception 'FAIL: client not emailed'; end if;
  if not exists (select 1 from public.cx_message_outbox where to_email = 'boss@x.test' and template = 'appeal-new') then raise exception 'FAIL: admin not emailed'; end if;
  raise notice 'PASS 037: emails queued and merged per thread';
end $$;

-- the creator can't settle; the client approves -> clip approved, everything deleted
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
do $$ begin
  begin perform public.appeal_resolve(current_setting('t.appeal')::uuid, 'approved'); raise exception 'FAIL: creator settled';
  exception when others then if sqlerrm not like 'Only the client%' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
do $$ declare r jsonb; begin
  r := public.appeal_resolve(current_setting('t.appeal')::uuid, 'approved');
  if r->>'outcome' <> 'approved' then raise exception 'FAIL: resolve %', r; end if;
end $$;
reset role;
do $$ begin
  if (select status from public.clip_submissions where id = '22222222-0000-0000-0000-000000000001') <> 'approved' then raise exception 'FAIL: clip not approved'; end if;
  if exists (select 1 from public.appeals) or exists (select 1 from public.appeal_messages) or exists (select 1 from public.appeal_reads) then
    raise exception 'FAIL: settled appeal not deleted'; end if;
  raise notice 'PASS 037: client approves, clip approved, conversation deleted for good';
end $$;

-- clip 2: appeal, then an admin approves it from the review queue -> appeal purged by the trigger
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
select public.appeal_open('22222222-0000-0000-0000-000000000002', 'Please check again') is not null;
reset role;
update public.clip_submissions set status = 'approved' where id = '22222222-0000-0000-0000-000000000002';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
do $$ begin
  if jsonb_array_length(public.appeal_list()) <> 0 or (select count(*) from public.appeal_messages) <> 0 then raise exception 'FAIL: appeal still shows after approval'; end if;
end $$;
reset role;
do $$ begin
  perform public.cx_appeal_sweep();
  if exists (select 1 from public.appeals) then raise exception 'FAIL: sweep did not delete'; end if;
  raise notice 'PASS 037: approving the clip anywhere hides its appeal at once; the sweep deletes it';
end $$;

-- support: Ben asks about payouts (allowed), admin replies, only admin can close
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set role authenticated;
do $$ declare r jsonb; begin
  r := public.support_open('When is my payout coming?', 'Payments & payouts');
  perform set_config('t.sup', r->>'id', false);
  begin perform public.appeal_resolve((r->>'id')::uuid, 'resolved'); raise exception 'FAIL: creator closed support';
  exception when others then if sqlerrm not like 'Only Clipency%' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
do $$ begin
  if jsonb_array_length(public.appeal_list()) <> 0 then raise exception 'FAIL: a client sees a creator''s support request'; end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ad', false);
do $$ declare r jsonb; sid uuid := current_setting('t.sup')::uuid; begin
  r := public.appeal_list();
  if jsonb_array_length(r) <> 1 or r->0->>'kind' <> 'support' or r->0->>'creator_email' <> 'ben@x.test' or r->0->>'requester_role' <> 'creator' then
    raise exception 'FAIL: admin support row %', r; end if;
  perform public.appeal_post(sid, 'Payouts go out on the 5th. Yours is in the next batch.');
  if public.appeal_outbox_count() < 1 then raise exception 'FAIL: outbox count'; end if;
  r := public.appeal_resolve(sid, 'resolved');
  if r->>'outcome' <> 'resolved' or exists (select 1 from public.appeals where id = current_setting('t.sup')::uuid) then raise exception 'FAIL: support close %', r; end if;
  raise notice 'PASS 037: support requests (money talk OK), staff reply and close';
end $$;
reset role;

do $$ begin raise notice 'ALL 037 TESTS PASSED'; end $$;
rollback;
