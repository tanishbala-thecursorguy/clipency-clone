-- 059: console "Log in" next to a creator or client: an admin opens that person's
-- dashboard in a new tab. The admin-login-as edge function checks cx_is_admin,
-- refuses other admins, makes a one-time sign-in link (nothing is emailed) and
-- records every use here. The tab keeps that session in its own sessionStorage,
-- so the admin's console login is untouched, and signing out there only ends that tab.
-- New table only.

create table public.admin_impersonations (
  id           bigserial primary key,
  admin_id     uuid not null,
  admin_email  text,
  target_id    uuid not null,
  target_email text,
  dashboard    text not null check (dashboard in ('creator', 'client')),
  created_at   timestamptz not null default now()
);
create index admin_impersonations_created on public.admin_impersonations(created_at desc);
alter table public.admin_impersonations enable row level security;
revoke all on public.admin_impersonations from anon, authenticated;
