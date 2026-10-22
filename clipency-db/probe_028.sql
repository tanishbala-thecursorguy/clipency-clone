-- Rolled-back probe for 028 (tracking until the campaign stops).
-- Run: select cx_probe.p028();  Ends with RAISE: nothing is kept.
create schema if not exists cx_probe;
revoke all on schema cx_probe from public, anon, authenticated;
create or replace function cx_probe.p028() returns void as $p$
declare
  cl  uuid := 'abbde415-7ab7-48d3-b422-628fc85e8be9';
  acc uuid := 'b2ef7b85-0328-47eb-949a-3634400b3902';
  tal uuid := 'af4614c4-d16e-4ee5-8c15-efa1d24a7676';
  wot uuid := 'd4308200-e70c-4465-bde5-e2c217be5b16';
  jst uuid := 'e18bb5d9-5ec8-416b-97a3-558275e3fd61';  -- Vingo: active, budget left (JSTJR has spent its pool)
  ids uuid[] := '{}'; v uuid; k int; out text[] := '{}';
  due uuid[];
  -- (age, hours since last fetch, campaign, expected due)
  cases text[][] := array[
    ['1 day',   '11',  'tal', 'f'], ['1 day',   '12',  'tal', 't'], ['1 day',  'null', 'tal', 't'],
    ['10 days', '12',  'tal', 'f'], ['10 days', '24',  'tal', 't'],
    ['20 days', '23',  'tal', 'f'], ['20 days', '24',  'tal', 't'], ['90 days', '24',  'jst', 't'],
    ['90 days', 'null','tal', 't'], ['20 days', '48',  'wot', 'f'], ['1 day',   'null','wot', 'f']];
  i int;
begin
  for i in 1 .. array_length(cases, 1) loop
    -- settling an approval resets the flag, so set it before every write
    perform set_config('clipency.trusted_write', '1', true);
    insert into public.clip_submissions (user_id, campaign_id, campaign_title, platform, handle, connected_account_id, clip_url, status)
    values (cl, case cases[i][3] when 'tal' then tal when 'jst' then jst else wot end::text, 'probe', 'Instagram', 'p', acc,
            'https://www.instagram.com/reel/ZZp028c' || i || '/', 'pending') returning id into v;
    perform set_config('clipency.trusted_write', '1', true);
    update public.clip_submissions
       set status = 'approved', reviewed_at = now(),
           created_at = now() - cases[i][1]::interval,
           metrics_status = case when cases[i][2] = 'null' then 'pending' else 'ok' end,
           metrics_fetched_at = case when cases[i][2] = 'null' then null else now() - (cases[i][2] || ' hours')::interval end
     where id = v;
    ids := ids || v;
  end loop;
  out := out || ('S0 every probe clip approved ' || case when (select count(*) from public.clip_submissions
      where id = any(ids) and status = 'approved') = array_length(cases, 1) then 'ok' else 'FAIL' end);
  perform set_config('clipency.trusted_write', '0', true);

  select array_agg(d.id) into due from public.clips_due_for_metrics(500) d where d.id = any(ids);
  for i in 1 .. array_length(cases, 1) loop
    out := out || (format('M%s age %s, last %sh, %s: %s ', i, cases[i][1], cases[i][2], cases[i][3],
                   case cases[i][4] when 't' then 'due' else 'not due' end)
                   || case when (ids[i] = any(coalesce(due, '{}'))) = (cases[i][4] = 't') then 'ok' else 'FAIL' end);
  end loop;

  out := out || ('E1 manual refresh allowed past day 14 on an active, in-budget campaign ' ||
    case when public.clip_metrics_eligible(ids[8]) then 'ok' else 'FAIL' end);
  out := out || ('E2 manual refresh refused on a paused campaign ' ||
    case when not public.clip_metrics_eligible(ids[10]) then 'ok' else 'FAIL' end);

  select count(*) into k from public.clips_due_for_metrics(500) d
    join public.clip_submissions s on s.id = d.id join public.campaigns c on c.id::text = s.campaign_id
   where c.status <> 'active' or s.status <> 'approved';
  out := out || ('L1 live queue holds only approved clips on active campaigns ' || case when k = 0 then 'ok' else 'FAIL ' || k end);

  raise exception 'PROBE %', array_to_string(out, ' | ');
end $p$ language plpgsql;
revoke all on function cx_probe.p028() from public, anon, authenticated;
