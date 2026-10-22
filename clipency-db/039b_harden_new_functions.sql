-- 039b: tighten the functions added in 036-039 (new objects only). Applied live 2026-10-22.
-- Internal helpers are only called from inside other functions: not callable from the browser.
revoke execute on function public.cx_display_name(uuid), public.cx_is_campaign_member(uuid, uuid), public.cx_is_ugc_campaign(uuid) from authenticated;
-- fixed search_path on the new pure helpers
alter function public.cx_gc_ttl_hours() set search_path = public;
alter function public.cx_gc_violation(text, text) set search_path = public;
alter function public.cx_chat_text(text, boolean) set search_path = public;
alter function public.cx_chat_image_ok(text, text) set search_path = public;
alter function public.cx_chat_violation(text, boolean) set search_path = public;
