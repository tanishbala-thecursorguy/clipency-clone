-- ============================================================
-- 024 · Task links
-- ============================================================
-- A task can carry several titled links rather than burying a URL inside
-- how_steps. A link may be scoped to one brand, which is exactly what
-- "join your brand group" needs: five brands, five different groups, and a
-- creator only ever sees the one for the brand they locked in.
--
-- The url check is not decoration. Ops types the value and the dashboard
-- renders it into an href, so anything that is not http or https is refused
-- at the table rather than trusted at the page.
-- ============================================================

create table if not exists clipathon.task_links (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references clipathon.tasks(id)  on delete cascade,
  brand_id    uuid          references clipathon.brands(id) on delete cascade,
  title       text not null,
  url         text not null,
  blurb       text,
  sort_order  smallint    not null default 0,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint task_links_title_ok check (btrim(title) <> '' and length(title) <= 80),
  constraint task_links_blurb_ok check (blurb is null or length(blurb) <= 200),
  constraint task_links_url_ok   check (url ~* '^https?://' and length(url) <= 2000)
);

create index if not exists task_links_task_idx
  on clipathon.task_links (task_id, sort_order, id);

create index if not exists task_links_brand_idx
  on clipathon.task_links (brand_id) where brand_id is not null;

drop trigger if exists trg_task_links_touch on clipathon.task_links;
create trigger trg_task_links_touch
  before update on clipathon.task_links
  for each row execute function clipathon.touch_updated_at();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table clipathon.task_links enable row level security;

drop policy if exists task_links_admin on clipathon.task_links;
create policy task_links_admin on clipathon.task_links
  for all
  using      (clipathon.has_role(array['ops','partnerships']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['ops','partnerships']::clipathon.admin_role[]));

-- A creator reads a link when the link and its task are live, and either the
-- link is general or it belongs to the brand sitting in their own slot.
-- Without the brand arm every creator would see all five group invites.
drop policy if exists task_links_read on clipathon.task_links;
create policy task_links_read on clipathon.task_links
  for select using (
    clipathon.is_admin()
    or (
      is_active
      and exists (
        select 1 from clipathon.tasks t
         where t.id = task_links.task_id and t.is_active
      )
      and (
        task_links.brand_id is null
        or exists (
          select 1 from clipathon.slots s
           where s.brand_id = task_links.brand_id
             and clipathon.owns_registration(s.registration_id)
        )
      )
    )
  );

-- ------------------------------------------------------------
-- join-wa no longer points at an email that is never sent
-- ------------------------------------------------------------
update clipathon.tasks
   set how_steps = array[
         'Lock in your brand slot first, the group is per brand',
         'Open the group link on this card',
         'Join with the same number you registered with',
         'We match the member list against registrations and award this for you'
       ],
       blurb = 'Every brand has its own creator group.',
       updated_at = now()
 where code = 'join-wa';
