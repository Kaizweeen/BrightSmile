-- Teams and reports (teams spec section 5): owner and staff roles, join links, the Monday summary's claim, and the
-- weekly counts behind the Reports page. Staff run the day; only the owner changes the clinic's setup and its team.

-- Refuses to run before the billing migration: regclass raises when clinic_billing does not exist yet, so pasting
-- this migration out of order fails fast instead of leaving clinic_members half migrated.
do $$ begin perform 'public.clinic_billing'::regclass; end $$;

-- 1. security definer, like is_clinic_member, so policies can read clinic_members without recursing. Defined first
-- because the clinic_members policy below, and the setup policies further down, both need it.
create function public.is_clinic_owner(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinic_members m
    where m.clinic_id = cid and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;
revoke execute on function public.is_clinic_owner(uuid) from public, anon;
grant execute on function public.is_clinic_owner(uuid) to authenticated;

-- 2. Staff join the owner. The default stays 'owner', which create_clinic relies on.
alter table public.clinic_members drop constraint clinic_members_role_check;
alter table public.clinic_members add constraint clinic_members_role_check check (role in ('owner', 'staff'));

-- Each member's login email, copied when the membership is made, so the Team page never reads auth.users.
alter table public.clinic_members add column email text check (char_length(email) <= 254);
update public.clinic_members m set email = u.email from auth.users u where u.id = m.user_id;

-- Data minimization (RA 10173): a staff member reads only their own membership row, never a colleague's email; the
-- owner reads every membership of their clinic (the Team page). Nobody writes memberships directly: only
-- create_clinic and accept_invite add them, and only remove_member deletes them.
drop policy "users see their memberships" on public.clinic_members;
create policy "members see their own row, the owner sees the clinic's" on public.clinic_members
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_clinic_owner(clinic_id));
revoke all on public.clinic_members from authenticated;
grant select on public.clinic_members to authenticated;

-- 3. Every member reads the clinic's setup; only the owner changes it (teams spec 4). Each "for all" owner policy is
-- split into insert, update, and delete (never a second select policy), so Supabase's advisor never sees two
-- permissive select policies stacked on one table.
drop policy "members update their clinic" on public.clinics;
create policy "owner updates the clinic" on public.clinics
  for update to authenticated
  using (public.is_clinic_owner(id)) with check (public.is_clinic_owner(id));

drop policy "members manage dentists" on public.dentists;
create policy "members read dentists" on public.dentists
  for select to authenticated
  using (public.is_clinic_member(clinic_id));
create policy "owner adds dentists" on public.dentists
  for insert to authenticated
  with check (public.is_clinic_owner(clinic_id));
create policy "owner updates dentists" on public.dentists
  for update to authenticated
  using (public.is_clinic_owner(clinic_id)) with check (public.is_clinic_owner(clinic_id));
create policy "owner deletes dentists" on public.dentists
  for delete to authenticated
  using (public.is_clinic_owner(clinic_id));

drop policy "members manage working hours" on public.working_hours;
create policy "members read working hours" on public.working_hours
  for select to authenticated
  using (public.is_clinic_member(clinic_id));
create policy "owner adds working hours" on public.working_hours
  for insert to authenticated
  with check (public.is_clinic_owner(clinic_id));
create policy "owner updates working hours" on public.working_hours
  for update to authenticated
  using (public.is_clinic_owner(clinic_id)) with check (public.is_clinic_owner(clinic_id));
create policy "owner deletes working hours" on public.working_hours
  for delete to authenticated
  using (public.is_clinic_owner(clinic_id));

drop policy "members manage procedures" on public.procedures;
create policy "members read procedures" on public.procedures
  for select to authenticated
  using (public.is_clinic_member(clinic_id));
create policy "owner adds procedures" on public.procedures
  for insert to authenticated
  with check (public.is_clinic_owner(clinic_id));
create policy "owner updates procedures" on public.procedures
  for update to authenticated
  using (public.is_clinic_owner(clinic_id)) with check (public.is_clinic_owner(clinic_id));
create policy "owner deletes procedures" on public.procedures
  for delete to authenticated
  using (public.is_clinic_owner(clinic_id));

-- 4. Join links (teams spec 5, 6.1). Only the token's SHA-256 is stored, so a leaked table holds no working links.
create table public.clinic_invites (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz
);
create index clinic_invites_clinic on public.clinic_invites (clinic_id, created_at);
alter table public.clinic_invites enable row level security;

create policy "owner reads invites" on public.clinic_invites
  for select to authenticated
  using (public.is_clinic_owner(clinic_id));
create policy "owner creates invites" on public.clinic_invites
  for insert to authenticated
  with check (public.is_clinic_owner(clinic_id) and created_by = (select auth.uid()));
-- Revoking is the only change the owner can make, and a revoked link never reopens.
create policy "owner revokes invites" on public.clinic_invites
  for update to authenticated
  using (public.is_clinic_owner(clinic_id))
  with check (public.is_clinic_owner(clinic_id) and revoked_at is not null);

-- Explicit grants: the owner sets only the clinic and the hash (the maker, the times, and the 7 day expiry are
-- defaults) and later only revoked_at. The secret key looks links up for the join page.
revoke all on public.clinic_invites from public, anon, authenticated;
grant select on public.clinic_invites to authenticated;
grant insert (clinic_id, token_hash) on public.clinic_invites to authenticated;
grant update (revoked_at) on public.clinic_invites to authenticated;
grant all on public.clinic_invites to service_role;

-- 5. The Monday a weekly summary was last claimed for, so the daily job pushes it once (teams spec 6.4).
alter table public.clinics add column weekly_report_for date;

-- 6. /join/{token} is the join page, so no clinic may take "join" as its booking link (must match RESERVED_SLUGS
-- in src/lib/validate.ts).
alter table public.clinics drop constraint clinics_slug_not_reserved;
alter table public.clinics add constraint clinics_slug_not_reserved check (
  slug not in ('a', 'app', 'api', 'auth', 'login', 'signup', 'onboarding', 'forgot',
               'reset-password', 'privacy', 'terms', 'admin', 'static', '_next', 'join')
);

-- 7. Onboarding also records the owner's email (teams spec 5). The rest is 20260925000200_billing.sql unchanged.
create or replace function public.create_clinic(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_clinic uuid;
  v_dentist uuid;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if exists (select 1 from public.clinic_members where user_id = v_user) then
    raise exception 'this account already has a clinic' using errcode = '23505';
  end if;

  insert into public.clinics (name, sms_name, slug, mobile, address)
  values (p->>'name', p->>'sms_name', p->>'slug', p->>'mobile', coalesce(p->>'address', ''))
  returning id into v_clinic;

  insert into public.clinic_members (clinic_id, user_id, email)
  values (v_clinic, v_user, (select u.email from auth.users u where u.id = v_user));

  insert into public.dentists (clinic_id, name, sms_name)
  values (v_clinic, p->'dentist'->>'name', p->'dentist'->>'sms_name')
  returning id into v_dentist;

  insert into public.working_hours (clinic_id, dentist_id, weekday, start_time, end_time)
  select v_clinic, v_dentist, (h->>'weekday')::smallint, (h->>'start')::time, (h->>'end')::time
  from jsonb_array_elements(p->'hours') h;

  insert into public.procedures (clinic_id, name, duration_minutes)
  select v_clinic, x->>'name', (x->>'minutes')::int
  from jsonb_array_elements(p->'procedures') x;

  insert into public.clinic_billing (clinic_id, trial_ends_at) values (v_clinic, now() + interval '14 days');

  return v_clinic;
end;
$$;
revoke execute on function public.create_clinic(jsonb) from public, anon;
grant execute on function public.create_clinic(jsonb) to authenticated;

-- 8. Joining through a link (teams spec 6.2). security definer because the caller belongs to no clinic yet. It
-- hashes the token itself and locks the invite, so a link works once even when two people open it together.
-- Refusals raise their own SQLSTATE so the join page can tell them apart:
--   BSUNK no such link, BSREV revoked, BSUSD already used, BSEXP expired,
--   23505 the caller already belongs to a clinic (as in create_clinic; the unique index raises it in a race too).
create function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_invite public.clinic_invites%rowtype;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select * into v_invite from public.clinic_invites
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
  for update;
  if not found then
    raise exception 'no such join link' using errcode = 'BSUNK';
  end if;
  if v_invite.revoked_at is not null then
    raise exception 'this join link was revoked' using errcode = 'BSREV';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'this join link was already used' using errcode = 'BSUSD';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'this join link expired' using errcode = 'BSEXP';
  end if;
  if exists (select 1 from public.clinic_members where user_id = v_user) then
    raise exception 'this account already has a clinic' using errcode = '23505';
  end if;

  insert into public.clinic_members (clinic_id, user_id, role, email)
  values (v_invite.clinic_id, v_user, 'staff', (select u.email from auth.users u where u.id = v_user));

  update public.clinic_invites set accepted_by = v_user, accepted_at = now() where id = v_invite.id;

  return v_invite.clinic_id;
end;
$$;
revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

-- 9. Removing staff (teams spec 5): only the owner of the member's clinic, never an owner row. The person's push
-- subscriptions for the clinic go in the same transaction, because sendPush reads them with the secret key and would
-- otherwise keep alerting their phone. The foreign key below backs this up for any other way a membership might go
-- away. BSNOS: no such staff member in a clinic the caller owns.
create function public.remove_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
begin
  select m.clinic_id into v_clinic from public.clinic_members m
  where m.user_id = p_user_id and m.role = 'staff' and public.is_clinic_owner(m.clinic_id)
  for update;
  if not found then
    raise exception 'no such staff member' using errcode = 'BSNOS';
  end if;

  delete from public.push_subscriptions where clinic_id = v_clinic and user_id = p_user_id;
  delete from public.clinic_members where clinic_id = v_clinic and user_id = p_user_id;
end;
$$;
revoke execute on function public.remove_member(uuid) from public, anon;
grant execute on function public.remove_member(uuid) to authenticated;

-- 10. The Reports page and the Monday summary (teams spec 5, 6.3, 6.4): one row per Manila week (Monday to Sunday,
-- by the appointment's start) and dentist, for p_weeks weeks from the Monday of p_from's week. security invoker, so
-- RLS limits a member to their own clinic; the daily job calls it with the secret key. Weeks and dentists without
-- appointments have no row. unmarked: confirmed visits that have started and nobody marked; upcoming: confirmed
-- visits still ahead; online and manual: every appointment by how it was booked, whatever its status.
create function public.clinic_week_stats(p_clinic_id uuid, p_from date, p_weeks integer)
returns table (
  week_start date,
  dentist_id uuid,
  completed integer,
  no_show integer,
  cancelled integer,
  declined integer,
  expired integer,
  unmarked integer,
  upcoming integer,
  online integer,
  manual integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (date_trunc('week', a.starts_at at time zone 'Asia/Manila'))::date,
    a.dentist_id,
    (count(*) filter (where a.status = 'completed'))::int,
    (count(*) filter (where a.status = 'no_show'))::int,
    (count(*) filter (where a.status = 'cancelled'))::int,
    (count(*) filter (where a.status = 'declined'))::int,
    (count(*) filter (where a.status = 'expired'))::int,
    (count(*) filter (where a.status = 'confirmed' and a.starts_at <= now()))::int,
    (count(*) filter (where a.status = 'confirmed' and a.starts_at > now()))::int,
    (count(*) filter (where a.source = 'online'))::int,
    (count(*) filter (where a.source = 'manual'))::int
  from public.appointments a
  where a.clinic_id = p_clinic_id
    and a.starts_at >= (date_trunc('week', p_from::timestamp) at time zone 'Asia/Manila')
    and a.starts_at < ((date_trunc('week', p_from::timestamp) + make_interval(weeks => p_weeks)) at time zone 'Asia/Manila')
  group by 1, 2
  order by 1, 2;
$$;
revoke execute on function public.clinic_week_stats(uuid, date, integer) from public, anon;
grant execute on function public.clinic_week_stats(uuid, date, integer) to authenticated, service_role;

-- 11. Data minimization (RA 10173): staff read no payment history, only the owner (teams spec 4, 5).
drop policy "members read their payments" on public.payments;
create policy "owner reads payments" on public.payments
  for select to authenticated
  using (public.is_clinic_owner(clinic_id));

-- 12. A removed member's push subscriptions always go with the membership, however the membership ends. Production
-- has no push_subscriptions rows yet, so adding this now is safe: nothing can already violate it.
alter table public.push_subscriptions
  add constraint push_subscriptions_member_fk
  foreign key (clinic_id, user_id) references public.clinic_members (clinic_id, user_id) on delete cascade;
create index push_subscriptions_member on public.push_subscriptions (clinic_id, user_id);
