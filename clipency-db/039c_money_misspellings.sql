-- 039c: the chat filter (037) also catches misspelt or shorthand money talk:
-- "250 ruppees", "rupay", "doller", "250rs", "500 inr", "250/-". Same as the UI.
-- Only the function added in 037 changes. Safe to re-run.
create or replace function public.cx_chat_violation(p_text text, p_allow_money boolean default false) returns text
language plpgsql immutable set search_path = public as $f$
declare t text := coalesce(p_text, '');
begin
  if t ~ '[\w.+-]+@[\w-]+\.[\w.-]+' then return 'email addresses'; end if;
  if t ~ '(?:\+?\d[\s().-]?){8,}' then return 'phone numbers'; end if;
  if t ~* '\y(whats\s?app|telegram|signal app|snap\s?chat|wechat|discord(?:\.gg)?|wa\.me|t\.me|skype)\y' then return 'other chat apps'; end if;
  if t ~* '\y(dm me|text me|call me|my number|phone number|contact me (?:on|at)|message me on|reach me (?:on|at))\y' then return 'requests to talk privately'; end if;
  if t ~* 'https?://(?!(?:www\.)?(?:instagram\.com|instagr\.am|tiktok\.com|vm\.tiktok\.com|youtube\.com|youtu\.be|clipency\.in)\y)\S+' then
    return 'outside links (only Instagram, TikTok and YouTube links are allowed)';
  end if;
  if not p_allow_money and (
       t ~* ('[$₹€£¥]|\y(rs\.?|inr|usd|eur|gbp|rupees?|dollars?|euros?|pounds?|bucks|paisa|lakhs?|lacs?|crores?|pay|paid|pays|paying|payment|payments|payout|payouts|money|cash|price|prices|pricing|rate|rates|rpm|cpm|fee|fees|salary|earn|earns|earned|earning|earnings|budget|budgets|invoice|invoices|upi|paypal|bank|transfer|tip|tips|bonus|bonuses|commission|compensation|per view|per video|per reel|per clip)\y')
       or t ~* '\y(rup+[aeiy]+\w*|dol+[aeo]r\w*)\y'          -- misspellings: ruppees, rupay, doller
       or t ~* '\d[\d,.]*\s*(rs?|inr|usd)\y'                 -- 250rs, 250 r, 500 inr
       or t ~ '\d\s*/-'                                      -- 250/-
     ) then
    return 'payment or money talk (amounts, currencies, rates or payouts)';
  end if;
  return '';
end $f$;
