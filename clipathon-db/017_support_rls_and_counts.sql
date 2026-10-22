-- =============================================================
-- CLIPATHON · 017 · two things the console found
-- =============================================================
-- Building the admin console surfaced a gap and an off-by-context
-- in the numbers it reads. Both are small, both matter.
-- =============================================================

-- -------------------------------------------------------------
-- 1. readonly could write to support
-- -------------------------------------------------------------
-- `tickets_admin` was ALL / is_admin(), and is_admin() is true for
-- every role including `readonly`. So the one role whose whole
-- purpose is "can look, cannot touch" could resolve tickets, edit
-- what a creator wrote, and post internal notes. Reading is right;
-- writing is not.
--
-- Split the policy: everyone on the console can read support, but
-- only the roles that actually answer tickets can change them.
drop policy if exists tickets_admin on clipathon.support_tickets;

create policy tickets_admin_update on clipathon.support_tickets
  for update to authenticated
  using      (clipathon.has_role(array['ops','reviewer','marketing']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['ops','reviewer','marketing']::clipathon.admin_role[]));

create policy tickets_admin_insert on clipathon.support_tickets
  for insert to authenticated
  with check (clipathon.has_role(array['ops','reviewer','marketing']::clipathon.admin_role[]));

-- Nobody deletes a ticket. A resolved ticket is the record of what
-- happened; deleting one destroys the only account of a dispute.
-- The absence of a delete policy is the rule.

-- Same reasoning for the messages on a ticket. The creator half of
-- this policy is unchanged: they may post a non-internal reply on
-- their own ticket.
drop policy if exists messages_write_self on clipathon.ticket_messages;

create policy messages_write on clipathon.ticket_messages
  for insert to authenticated
  with check (
    ( not is_internal
      and exists (select 1 from clipathon.support_tickets t
                   where t.id = ticket_messages.ticket_id
                     and t.creator_id = clipathon.my_creator_id()) )
    or clipathon.has_role(array['ops','reviewer','marketing']::clipathon.admin_role[])
  );

comment on policy tickets_admin_update on clipathon.support_tickets is
  'Operators who answer tickets can change them. readonly and finance can read only.';

-- -------------------------------------------------------------
-- 2. the SLA breach count was counting closed tickets
-- -------------------------------------------------------------
-- `tickets_breach` counted every ticket whose first response was
-- never stamped and whose SLA time has passed, including tickets
-- that were long since resolved. A ticket resolved in one reply
-- without the stamp being set would sit in that number forever, so
-- the console showed a permanent red figure nobody could clear.
-- A breach is only a breach while the ticket is still open.
create or replace function clipathon.admin_overview(p_cycle_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare cy record;
begin
  if not clipathon.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  if p_cycle_id is null then
    select * into cy from clipathon.cycles where status <> 'archived'
     order by registration_closes desc limit 1;
  else
    select * into cy from clipathon.cycles where id = p_cycle_id;
  end if;
  if cy.id is null then return jsonb_build_object('ok', false, 'error', 'no_cycle'); end if;

  return jsonb_build_object(
    'ok', true,
    'cycle', to_jsonb(cy),
    'counts', jsonb_build_object(
      'registrations',   (select count(*) from clipathon.registrations where cycle_id = cy.id),
      'queue',           (select count(*) from clipathon.registrations where cycle_id = cy.id and status in ('pending','needs_info')),
      'approved',        (select count(*) from clipathon.registrations where cycle_id = cy.id and status = 'approved'),
      'rejected',        (select count(*) from clipathon.registrations where cycle_id = cy.id and status = 'rejected'),
      'accounts_pending',(select count(*) from clipathon.creator_accounts where status = 'pending'),
      'with_login',      (select count(*) from clipathon.creators c join clipathon.registrations r on r.creator_id = c.id
                           where r.cycle_id = cy.id and c.auth_user_id is not null),
      'ready',           (select count(*) from clipathon.v_creator_readiness where cycle_id = cy.id and ready_for_slot_selection),
      'slots',           (select count(*) from clipathon.slots where cycle_id = cy.id),
      'slots_auto',      (select count(*) from clipathon.slots where cycle_id = cy.id and auto_assigned),
      'subs_complete',   (select count(*) from clipathon.submissions where cycle_id = cy.id and is_complete),
      'subs_queue',      (select count(*) from clipathon.submissions where cycle_id = cy.id and status in ('complete','under_review')),
      'subs_verified',   (select count(*) from clipathon.submissions where cycle_id = cy.id and status = 'verified'),
      'subs_dq',         (select count(*) from clipathon.submissions where cycle_id = cy.id and status = 'disqualified'),
      'scored',          (select count(*) from clipathon.scores where cycle_id = cy.id),
      'locked',          (select count(*) from clipathon.scores where cycle_id = cy.id and locked_at is not null),
      'tickets_open',    (select count(*) from clipathon.support_tickets where status in ('open','in_progress')),
      'tickets_breach',  (select count(*) from clipathon.support_tickets
                           where status in ('open','in_progress')
                             and first_response_at is null
                             and sla_due_at < now()),
      'total_slots',     cy.total_slots
    ),
    'me', jsonb_build_object(
      'role', (select role from clipathon.admin_users where user_id = auth.uid()),
      'email',(select email from clipathon.admin_users where user_id = auth.uid()))
  );
end;
$$;

revoke execute on function clipathon.admin_overview(uuid) from public;
grant  execute on function clipathon.admin_overview(uuid) to authenticated;
