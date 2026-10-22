-- 022  Leaderboards must aggregate across every creator.
--
-- Both leaderboard views were security_invoker = on, so they inherited the
-- caller's RLS. The policies are "your own row, or an admin", so a plain
-- creator could only ever see themselves, and saw nothing at all until they
-- had earned a point. The board looked frozen no matter what anyone did.
--
-- These two views are the only place where cross creator reads are intended,
-- so they run as the view owner. The exposure is deliberately narrow: a
-- display name, a creator code, point totals and a rank. Nothing else in the
-- schema changes, and every base table keeps its RLS for direct reads.

alter view clipathon.v_season_leaderboard   set (security_invoker = off);
alter view clipathon.v_referral_leaderboard set (security_invoker = off);

-- Read only. Nobody writes through a leaderboard.
revoke insert, update, delete on clipathon.v_season_leaderboard   from authenticated;
revoke insert, update, delete on clipathon.v_referral_leaderboard from authenticated;

grant select on clipathon.v_season_leaderboard   to authenticated;
grant select on clipathon.v_referral_leaderboard to authenticated;

comment on view clipathon.v_season_leaderboard is
  'Season standings. Runs as owner on purpose so every creator sees the whole board. Exposes display name, creator code, point totals and rank only.';
comment on view clipathon.v_referral_leaderboard is
  'Referral standings. Runs as owner on purpose, same reasoning as v_season_leaderboard.';
