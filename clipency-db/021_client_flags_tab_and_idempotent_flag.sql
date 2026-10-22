-- 021 · The client sees what happened to the clips they flagged, and
--       flagging the same clip twice is not an error.
--
-- 1. client_dashboard_data() returned clips with status approved or flagged
--    only. Once Clipency upheld a flag the clip became 'rejected' and simply
--    vanished from the client's portal, so the client never saw the outcome
--    of their own flag. It now also returns any clip that carries a client
--    flag, whatever its status, with the flag's resolution and when it was
--    resolved. Billing is unaffected: every spend figure counts approved
--    clips only, server side and in the portal.
--
-- 2. client_flag_clip() raised "this clip is already flagged" on a second
--    attempt. Ayush hit it on 23 Sep: the first flag at 07:21 went through,
--    the clip was still on screen (the portal replays a 90 s cached payload
--    on reload), and the retry showed an error styled as a success. A repeat
--    flag of a clip that is already flagged now returns the existing open
--    flag with already = true. The portal treats that as done.
do $mig$
declare d text; n text;
begin
  d := pg_get_functiondef('public.client_dashboard_data()'::regprocedure);
  n := replace(d, $x$      where s.status in ('approved','flagged')$x$,
                  $x$      where (s.status in ('approved','flagged')
             or exists (select 1 from public.clip_flags fx where fx.submission_id = s.id))$x$);
  n := replace(n, $x$'at', f.created_at)$x$, $x$'at', f.created_at,
                          'resolved_at', f.resolved_at)$x$);
  if n = d or position('fx.submission_id = s.id' in n) = 0 or position('''resolved_at'', f.resolved_at' in n) = 0 then
    raise exception 'client_dashboard_data: not every replacement applied';
  end if;
  execute n;

  d := pg_get_functiondef('public.client_flag_clip(uuid,text)'::regprocedure);
  n := replace(d, $x$if s.status = 'flagged'  then raise exception 'this clip is already flagged';  end if;$x$,
$x$if s.status = 'flagged' then
    select id into fid from public.clip_flags
     where submission_id = s.id and resolution = 'open'
     order by created_at desc limit 1;
    if fid is not null then
      return jsonb_build_object('flag_id', fid, 'status', 'flagged', 'already', true);
    end if;
    raise exception 'this clip is already flagged';
  end if;$x$);
  if n = d then raise exception 'client_flag_clip: repeat-flag branch not replaced'; end if;
  execute n;
end $mig$;
