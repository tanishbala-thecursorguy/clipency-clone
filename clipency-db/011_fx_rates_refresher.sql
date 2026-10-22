-- 011 · Refresher for cx_fx_rates.
--
-- pg_net is asynchronous: http_get queues a request and returns an id, and the
-- body turns up in net._http_response a moment later. So this is two steps -
-- cx_fx_fetch queues, cx_fx_absorb reads - and the id is parked in between.
-- Both are called by cron, two minutes apart (see 013).

create table if not exists public.cx_fx_requests (
  id            bigint primary key,
  requested_at  timestamptz not null default now(),
  absorbed_at   timestamptz,
  outcome       text
);

comment on table public.cx_fx_requests is
  'Outstanding and recent pg_net requests for FX rates. outcome records what came back, so a quiet failure is still on the record.';

alter table public.cx_fx_requests enable row level security;   -- definer-only

create or replace function public.cx_fx_fetch()
returns bigint
language plpgsql
security definer
set search_path = public, net, pg_temp
as $$
declare
  v_symbols text;
  v_id bigint;
begin
  -- ask only for what the app can render
  select string_agg(currency, ',' order by currency)
    into v_symbols
  from public.cx_fx_rates
  where currency <> 'USD';

  if v_symbols is null then
    return null;
  end if;

  select net.http_get(
           url := 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=' || v_symbols,
           timeout_milliseconds := 8000)
    into v_id;

  insert into public.cx_fx_requests (id) values (v_id);

  -- keep the log short
  delete from public.cx_fx_requests where requested_at < now() - interval '30 days';

  return v_id;
end $$;

comment on function public.cx_fx_fetch() is
  'Queues one ECB rate request through pg_net and records its id. Call cx_fx_absorb a minute or two later.';

create or replace function public.cx_fx_absorb()
returns integer
language plpgsql
security definer
set search_path = public, net, pg_temp
as $$
declare
  r          record;
  v_body     jsonb;
  v_as_of    date;
  v_written  integer := 0;
begin
  for r in
    select q.id
    from public.cx_fx_requests q
    where q.absorbed_at is null
    order by q.requested_at
  loop
    select case
             when resp.status_code = 200 and resp.content is not null
             then resp.content::jsonb
           end
      into v_body
    from net._http_response resp
    where resp.id = r.id;

    if v_body is null then
      -- no answer yet, or not a usable one. Leave it for the next run unless
      -- it has clearly aged out.
      update public.cx_fx_requests
         set absorbed_at = now(), outcome = 'no usable response'
       where id = r.id
         and requested_at < now() - interval '1 hour';
      continue;
    end if;

    v_as_of := nullif(v_body->>'date','')::date;
    if v_as_of is null then
      update public.cx_fx_requests
         set absorbed_at = now(), outcome = 'response carried no date'
       where id = r.id;
      continue;
    end if;

    -- A rate that is not a positive number is dropped, not stored: a zero here
    -- would stamp a creator's earnings at zero.
    insert into public.cx_fx_rates as t (currency, rate_per_usd, as_of, source, fetched_at)
    select upper(e.k), e.v::numeric, v_as_of, 'ecb/frankfurter', now()
    from jsonb_each_text(v_body->'rates') as e(k, v)
    where e.v ~ '^[0-9]+(\.[0-9]+)?$'
      and e.v::numeric > 0
    on conflict (currency) do update
      set rate_per_usd = excluded.rate_per_usd,
          as_of        = excluded.as_of,
          source       = excluded.source,
          fetched_at   = excluded.fetched_at
      -- only move forward in time, so a replayed old response cannot regress
      where excluded.as_of >= t.as_of;

    v_written := v_written + 1;

    update public.cx_fx_requests
       set absorbed_at = now(),
           outcome = 'applied ' || v_as_of::text
     where id = r.id;
  end loop;

  return v_written;
end $$;

comment on function public.cx_fx_absorb() is
  'Reads whatever cx_fx_fetch queued and upserts cx_fx_rates. Ignores non-200s, missing dates, and any rate that is not a positive number; never regresses a newer as_of.';

revoke all on function public.cx_fx_fetch() from public, anon, authenticated;
revoke all on function public.cx_fx_absorb() from public, anon, authenticated;
