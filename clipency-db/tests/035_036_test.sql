-- Behaviour tests for 035 (24h reviews) + 036 (creator type). Local only. Rolled back.
\set ON_ERROR_STOP 1
begin;
insert into auth.users values ('00000000-0000-0000-0000-0000000000c1', 'client@x.test'), ('00000000-0000-0000-0000-0000000000a1', 'amy@x.test'),
  ('00000000-0000-0000-0000-0000000000ad', 'boss@x.test');
insert into public.profiles (id, email, role, display_name, client_access) values
  ('00000000-0000-0000-0000-0000000000c1', 'client@x.test', 'clipper', 'Acme', true),   -- a client through client_access, like live
  ('00000000-0000-0000-0000-0000000000a1', 'amy@x.test', 'clipper', 'Amy', false),
  ('00000000-0000-0000-0000-0000000000ad', 'boss@x.test', 'admin', 'Boss', false);
insert into public.admin_users (user_id, email) values ('00000000-0000-0000-0000-0000000000ad', 'boss@x.test');
insert into public.campaigns (id, title, brand_name, client_user_id, client_review_hours, category) values
  ('11111111-0000-0000-0000-000000000001', 'Acme launch', 'Acme', '00000000-0000-0000-0000-0000000000c1', 24, 'Tech'),
  ('11111111-0000-0000-0000-000000000002', 'Acme UGC', 'Acme', '00000000-0000-0000-0000-0000000000c1', 12, 'UGC');
insert into public.clip_submissions (id, user_id, campaign_id, clip_url, status) values
  ('22222222-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-000000000001', 'https://www.instagram.com/reel/AAA111/', 'pending'),
  ('22222222-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-000000000001', 'https://www.instagram.com/reel/AAA222/', 'pending');

do $$ begin
  begin update public.campaigns set client_review_hours = 48 where id = '11111111-0000-0000-0000-000000000001'; raise exception 'FAIL: 48h allowed';
  exception when check_violation then null; end;
  update public.campaigns set client_review_hours = 24 where id = '11111111-0000-0000-0000-000000000001';
  if (select column_default from information_schema.columns where table_name = 'campaigns' and column_name = 'client_review_hours') <> '24' then raise exception 'FAIL: default'; end if;
  if (select review_due_at from public.clip_submissions where id = '22222222-0000-0000-0000-000000000001') > now() + interval '24 hours 1 minute' then raise exception 'FAIL: new clip not on 24h'; end if;
  raise notice 'PASS 035: review window max 24h, default 24, new clips get 24h';
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
set role authenticated;
do $$ begin
  begin perform public.client_review_clip('22222222-0000-0000-0000-000000000001', false, 'bad edit'); raise exception 'FAIL: short reason allowed';
  exception when others then if sqlerrm not like 'Write why%' then raise; end if; end;
  perform public.client_review_clip('22222222-0000-0000-0000-000000000001', false, 'Audio is out of sync with the video');
  perform public.client_review_clip('22222222-0000-0000-0000-000000000002', true);
  raise notice 'PASS 035: rejections need 15+ characters; approve unchanged';
end $$;
reset role;
do $$ begin
  if (select rejection_reason from public.clip_submissions where id = '22222222-0000-0000-0000-000000000001') <> 'Rejected by the client: Audio is out of sync with the video'
     or (select status from public.clip_submissions where id = '22222222-0000-0000-0000-000000000002') <> 'approved' then raise exception 'FAIL: review writes'; end if;
end $$;

-- 036
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
do $$ declare r jsonb; begin
  if public.creator_get_type() is not null then raise exception 'FAIL: type before picking'; end if;
  perform public.creator_set_type('ugc');
  begin perform public.creator_set_type('influencer'); raise exception 'FAIL: bad type';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  if public.creator_get_type() <> 'ugc' then raise exception 'FAIL: type not saved'; end if;
  perform public.creator_set_type('clipper');
  if public.creator_get_type() <> 'clipper' or (select count(*) from public.creator_types) <> 1 then raise exception 'FAIL: switch'; end if;
  r := public.ugc_campaigns();
  if jsonb_array_length(r) <> 1 or r->0->>'title' <> 'Acme UGC' then raise exception 'FAIL: ugc_campaigns %', r; end if;
  raise notice 'PASS 036: creator type saved in its own table, switchable, UGC campaigns listed';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
do $$ begin
  if (select count(*) from public.creator_types) <> 0 then raise exception 'FAIL: someone else''s type readable'; end if;
  begin insert into public.creator_types values (auth.uid(), 'ugc'); raise exception 'FAIL: direct write';
  exception when insufficient_privilege then null; end;
  raise notice 'ALL 035/036 TESTS PASSED';
end $$;
reset role;
rollback;
