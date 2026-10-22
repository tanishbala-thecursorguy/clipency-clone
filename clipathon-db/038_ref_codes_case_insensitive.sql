-- =============================================================
-- CLIPATHON · 038 · referral codes are case insensitive
-- =============================================================
-- Links are handed to influencers in lower case now, because
-- clipency.in/r/aarav07 reads like something a person would type and
-- SHOUTING in an Instagram bio does not. The code itself is still
-- stored upper case: one code has to mean exactly one owner, and the
-- moment 'divya' and 'DIVYA' can both exist as separate rows, taps and
-- registrations start splitting silently between two people.
--
-- So this migration makes the storage side enforce what the console
-- already does by hand:
--
--   1. anything written to ref_links.code or ambassadors.ref_code is
--      upper cased on the way in, so a lower case insert from any
--      client succeeds instead of tripping the shape constraint
--   2. uniqueness is checked on the upper cased value, so no two
--      referrers can ever hold the same code in different cases
--
-- Nothing existing moves. Every code already in the table is upper
-- case, and this was verified to hold for all three tables before the
-- unique indexes below were created.
-- =============================================================

-- -------------------------------------------------------------
-- 1. normalise on the way in
-- -------------------------------------------------------------
create or replace function clipathon.upper_ref_code()
returns trigger
language plpgsql
set search_path = clipathon, pg_temp
as $$
begin
  if tg_table_name = 'ref_links' then
    new.code := upper(btrim(coalesce(new.code, '')));
  elsif tg_table_name = 'ambassadors' then
    new.ref_code := upper(btrim(coalesce(new.ref_code, '')));
  end if;
  return new;
end;
$$;

drop trigger if exists ref_links_upper_code on clipathon.ref_links;
create trigger ref_links_upper_code
  before insert or update of code on clipathon.ref_links
  for each row execute function clipathon.upper_ref_code();

drop trigger if exists ambassadors_upper_code on clipathon.ambassadors;
create trigger ambassadors_upper_code
  before insert or update of ref_code on clipathon.ambassadors
  for each row execute function clipathon.upper_ref_code();

-- -------------------------------------------------------------
-- 2. uniqueness that ignores case
-- -------------------------------------------------------------
-- ambassadors.ref_code already carries a plain unique constraint, which
-- is case sensitive and therefore lets 'divya' sit next to 'DIVYA'.
-- register_creator resolves a code with upper(ref_code) = p_ref_code,
-- so that pair would match two rows and credit whichever the planner
-- happened to return first. The index below makes the pair impossible.
create unique index if not exists ambassadors_ref_code_ci_unique
  on clipathon.ambassadors (upper(ref_code));

create unique index if not exists creators_referral_code_ci_unique
  on clipathon.creators (upper(referral_code));

create unique index if not exists ref_links_code_ci_unique
  on clipathon.ref_links (cycle_id, upper(code));

-- -------------------------------------------------------------
-- 3. a shape check on the ambassador code too
-- -------------------------------------------------------------
-- ref_links has had one since 034. ambassadors never did, which is how
-- a code with a space or a slash in it could be saved and then quietly
-- fail to survive a URL. Same alphabet as the link: letters, digits,
-- dot, dash, underscore, 3 to 24 characters.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'clipathon.ambassadors'::regclass
       and conname  = 'ambassadors_ref_code_shape')
  then
    alter table clipathon.ambassadors
      add constraint ambassadors_ref_code_shape
      check (ref_code ~ '^[A-Z0-9][A-Z0-9._-]{2,23}$') not valid;
  end if;
end $$;
