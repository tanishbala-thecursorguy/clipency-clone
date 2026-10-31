-- 048: instant creator sign-up (no confirmation email) and a daily cap on promotions.
-- APPLIED to live (spwtkdgpgeutrhwcjrpy) on 2026-10-31 with the owner's approval.
--
-- New functions, and promo_batch / promo_kick (both from 044) now respect the cap.
-- No table change.
--
-- 1. cx_signup_lookup(email): for the creator-signup edge function (service role only).
--    Says whether the email already has an account, whether it is confirmed or ever
--    signed in, its profile role, and any pending staff/client invite. The function
--    only creates or confirms plain creator accounts; anything with an invite or a
--    non-creator role keeps the normal confirmation email.
--
-- 2. promo_daily_cap(): at most 150 promotion emails per India day, all promotions
--    together. A big send (the weekly article to ~900) spreads over several days:
--    150 Fri, 150 Sat, ... until it is done. Account emails are not counted or capped.

begin;

create or replace function public.cx_signup_lookup(p_email text)
returns jsonb language sql stable security definer set search_path = public, auth as $$
  select jsonb_build_object(
    'user_id',    u.id,
    'confirmed',  u.email_confirmed_at is not null,
    'signed_in',  u.last_sign_in_at is not null,
    'role',       p.role,
    'invite',     (select i.role from public.access_invites i
                    where lower(i.email) = lower(btrim(p_email)) and i.status = 'pending'
                    order by i.created_at desc limit 1))
  from (select 1) one
  left join auth.users u on lower(u.email) = lower(btrim(p_email))
  left join public.profiles p on p.id = u.id
  limit 1
$$;
revoke execute on function public.cx_signup_lookup(text) from public, anon, authenticated;

create or replace function public.promo_daily_cap()
returns int language sql immutable as $$ select 150 $$;

-- Promotion emails already sent today (India time).
create or replace function public.promo_sent_today()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from promo_sends
   where status = 'sent'
     and sent_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
$$;
revoke execute on function public.promo_sent_today() from public, anon, authenticated;

create or replace function public.promo_batch(p_limit int default 90)
returns table (id bigint, promo_id bigint, email text, first_name text, from_email text, token uuid,
               subject text, html text, text_body text)
language plpgsql security definer set search_path = public as $$
declare room int := greatest(0, promo_daily_cap() - promo_sent_today());
begin
  delete from promo_sends s using promo_unsubscribes x where s.status = 'queued' and x.email = s.email;
  update promo_emails e set status = 'sending', updated_at = now()
   where e.status = 'approved' and e.send_at <= now();
  return query
    select s.id, s.promo_id, s.email, s.first_name, s.from_email, s.token, e.subject, e.html, e.text_body
    from promo_sends s join promo_emails e on e.id = s.promo_id
    where s.status = 'queued' and e.status = 'sending'
    order by s.id limit least(p_limit, room);
end $$;

create or replace function public.promo_kick()
returns bigint language plpgsql security definer set search_path = public, extensions, vault as $$
declare key text; req bigint;
begin
  if promo_sent_today() >= promo_daily_cap() then return null; end if;
  if not exists (select 1 from promo_sends s join promo_emails e on e.id = s.promo_id
                 where s.status = 'queued' and e.status in ('approved', 'sending') and e.send_at <= now()) then
    return null;
  end if;
  select decrypted_secret into key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if key is null then raise warning 'promo_kick: service_role_key missing'; return null; end if;
  select net.http_post(
    url     := 'https://spwtkdgpgeutrhwcjrpy.supabase.co/functions/v1/promo-emails',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key),
    body    := jsonb_build_object('mode', 'send'),
    timeout_milliseconds := 60000) into req;
  return req;
end $$;

revoke execute on function public.promo_batch(int) from public, anon, authenticated;
revoke execute on function public.promo_kick()     from public, anon, authenticated;

commit;
