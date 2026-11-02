-- 056: Telegram alerts go to a direct message instead of the group's topics.
--
-- tg_send() posted into the team group (chat_id + a topic per kind). The owner wants
-- every alert (client on the dashboard, new lead, payout request, appeal, new
-- account, new clip) as a DM to @Jakeai05. When telegram_config has 'dm_chat_id'
-- (the numeric Telegram ID of the person, who must have pressed Start on the bot),
-- alerts go there with no topic; without it, behaviour is exactly as before.
--
-- The bot token ('bot_token') is set by the owner in the Supabase SQL editor; it is
-- never written here. Same signature, so every existing caller is unchanged.

create or replace function public.tg_send(p_thread text, p_text text, p_reply_markup jsonb default null::jsonb)
returns bigint language plpgsql security definer set search_path to 'public' as $function$
declare
  v_token text; v_chat text; v_thread_id text; v_dm text; v_req_id bigint;
begin
  select value into v_token from telegram_config where key = 'bot_token';
  select value into v_dm    from telegram_config where key = 'dm_chat_id';
  select value into v_chat  from telegram_config where key = 'chat_id';
  select value into v_thread_id from telegram_config where key = p_thread;
  if nullif(v_dm, '') is not null then v_chat := v_dm; v_thread_id := null; end if;
  if v_token is null or v_chat is null then return null; end if;
  select net.http_post(
    url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := jsonb_strip_nulls(jsonb_build_object(
      'chat_id', v_chat::bigint,
      'message_thread_id', v_thread_id::int,
      'text', p_text,
      'parse_mode', 'HTML',
      'reply_markup', p_reply_markup
    ))
  ) into v_req_id;
  return v_req_id;
exception when others then
  return null;
end;
$function$;
