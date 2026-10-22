-- 020 · Per-view earnings: round to USD once, not twice.
--
-- cs_calc_earning priced a per-view clip in the campaign's currency, rounded
-- that to 2 dp, then divided by the fx rate and rounded again. On a USD
-- campaign (fx = 1) the second step is a no-op. On any other currency it is
-- double rounding: $26.545 of views came out as Rs 2,543.54, which is
-- $26.5449, which is $26.54, a cent short of what the same views earn on a
-- USD campaign. Found while testing 019: converting Tal's Pod to INR and
-- refreshing its metrics moved 8 of 78 clips by a cent, both ways.
--
-- Now the USD figure is taken from the unrounded amount whenever no cap or
-- pool limit cut it. For USD campaigns this is identical to before
-- (round(x / 1, 2) = round(x, 2)); every existing campaign is USD, so no
-- current figure changes.
do $mig$
declare d text; n text;
begin
  d := pg_get_functiondef('public.cs_calc_earning()'::regprocedure);
  n := replace(d, 'paid_views numeric; amt numeric;', 'paid_views numeric; amt numeric; raw numeric;');
  n := replace(n, 'amt := round(paid_views / 1000000 * rate, 2);',
                  'raw := paid_views / 1000000 * rate;' || chr(10) || '  amt := round(raw, 2);');
  n := replace(n, 'new.approved_amount       := round(amt / fx, 2);',
                  'new.approved_amount       := case when amt = round(raw, 2) then round(raw / fx, 2)' || chr(10) ||
                  '                                   else round(amt / fx, 2) end;');
  if n = d
     or position('raw numeric;' in n) = 0
     or position('amt := round(raw, 2);' in n) = 0
     or position('round(raw / fx, 2)' in n) = 0 then
    raise exception 'cs_calc_earning: not every replacement applied';
  end if;
  execute n;
end $mig$;
