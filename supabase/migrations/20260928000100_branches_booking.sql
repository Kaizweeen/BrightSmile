-- Branches and the booking engine (booking flow spec sections 4 to 6): each clinic's branches with their own address
-- and calendar, the patient form and waiver, and a patient's own change to a booking. Plan 7 builds the data and the
-- server side; the new pages come in plan 8.

-- Refuses to run before the teams migration: regclass raises when clinic_invites does not exist yet, so pasting this
-- migration out of order fails fast instead of leaving the schema half migrated.
do $$ begin perform 'public.clinic_invites'::regclass; end $$;

-- 1. Branches (spec 4). One clinic keeps one account, one booking link, and one set of patients, procedures, and
-- staff; each branch has its own address and calendar. sms_name is the branch's short name for texts: with 2 or more
-- active branches a text's clinic field is the clinic's text name, a space, and this, at most 20 characters together
-- (smsClinicName and branchSmsNameProblem in src/lib/branches.ts), so a branch's is at most 18.
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  sms_name text not null check (char_length(sms_name) between 1 and 18),
  address text not null default '' check (char_length(address) <= 200),
  maps_url text check (maps_url ~ '^https://'),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, clinic_id)
);
create index branches_clinic on public.branches (clinic_id, sort);
alter table public.branches enable row level security;

-- Members read their clinic's branches; only the owner adds, edits, and deactivates them (spec 4), split per command
-- like the teams migration's setup policies.
create policy "members read branches" on public.branches
  for select to authenticated
  using (public.is_clinic_member(clinic_id));
create policy "owner adds branches" on public.branches
  for insert to authenticated
  with check (public.is_clinic_owner(clinic_id));
create policy "owner updates branches" on public.branches
  for update to authenticated
  using (public.is_clinic_owner(clinic_id)) with check (public.is_clinic_owner(clinic_id));
create policy "owner deletes branches" on public.branches
  for delete to authenticated
  using (public.is_clinic_owner(clinic_id));

-- Explicit grants: a branch never moves to another clinic (clinic_id is not updatable), and visitors see branches only
-- through the server's secret key (the public booking page).
revoke all on public.branches from public, anon, authenticated;
grant select, insert, delete on public.branches to authenticated;
grant update (name, sms_name, address, maps_url, active, sort) on public.branches to authenticated;
grant all on public.branches to service_role;

-- 2. A clinic always keeps an active branch (spec 4), whoever deactivates or deletes it. The advisory lock serializes
-- changes to one clinic's branches, so two tabs can never each retire "the other" last branch. Deleting the clinic
-- itself (by hand, as the operator) still cascades: by then the clinic row is gone. BSLAB: the last active branch.
create function public.keep_an_active_branch()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_retires boolean;
begin
  if tg_op = 'DELETE' then
    v_retires := old.active;
  else
    v_retires := old.active and not new.active;
  end if;
  if v_retires then
    perform pg_advisory_xact_lock(hashtext('branches:' || old.clinic_id::text));
    if exists (select 1 from public.clinics c where c.id = old.clinic_id)
       and not exists (
         select 1 from public.branches b where b.clinic_id = old.clinic_id and b.active and b.id <> old.id
       ) then
      raise exception 'a clinic keeps at least one active branch' using errcode = 'BSLAB';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function public.keep_an_active_branch() from public, anon, authenticated;
create trigger keep_an_active_branch
  before update of active or delete on public.branches
  for each row execute function public.keep_an_active_branch();

-- 3. Every existing clinic gets one branch, "Main", from its address and map link, and all its working hours and
-- appointments move to it (spec 4). The owner renames it in Settings. Composite keys keep a branch, its clinic, and
-- the dentist's clinic consistent, like the existing ones.
insert into public.branches (clinic_id, name, sms_name, address, maps_url)
select id, 'Main', 'Main', address, maps_url from public.clinics;

alter table public.working_hours add column branch_id uuid;
update public.working_hours h set branch_id = b.id from public.branches b where b.clinic_id = h.clinic_id;
alter table public.working_hours alter column branch_id set not null;
alter table public.working_hours
  add foreign key (branch_id, clinic_id) references public.branches (id, clinic_id) on delete cascade;

-- A branch with appointments is deactivated, never deleted. The existing no_overlap guard is per dentist, so a dentist
-- can never be booked at two branches at once.
alter table public.appointments add column branch_id uuid;
update public.appointments a set branch_id = b.id from public.branches b where b.clinic_id = a.clinic_id;
alter table public.appointments alter column branch_id set not null;
alter table public.appointments
  add foreign key (branch_id, clinic_id) references public.branches (id, clinic_id);

-- 4. The patient form and waiver (spec 6), filled once per new patient on the public booking page. Health information
-- is sensitive personal information (RA 10173): only the clinic's members read it (the existing patients policy), it
-- never appears in texts, pushes, logs, or reports, and anonymizing a patient clears all of it. The limits match
-- src/lib/intake.ts; medical is the object parseMedical builds there.
alter table public.patients
  add column middle_name text check (char_length(middle_name) between 1 and 50),
  add column sex text check (sex in ('female', 'male')),
  add column address text check (char_length(address) between 1 and 200),
  add column occupation text check (char_length(occupation) between 1 and 60),
  add column email text check (char_length(email) <= 254 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  add column guardian_name text check (char_length(guardian_name) between 1 and 100),
  add column hmo_number text check (char_length(hmo_number) between 1 and 40),
  add column previous_dentist text check (char_length(previous_dentist) between 1 and 100),
  add column last_visit text check (last_visit ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  add column visit_reason text check (char_length(visit_reason) between 1 and 200),
  add column emergency_name text check (char_length(emergency_name) between 1 and 100),
  add column emergency_mobile text check (emergency_mobile ~ '^\+639[0-9]{9}$'),
  add column waiver_name text check (char_length(waiver_name) between 1 and 150),
  add column waiver_version text check (char_length(waiver_version) between 1 and 20),
  add column waiver_at timestamptz,
  add column medical jsonb check (jsonb_typeof(medical) = 'object' and octet_length(medical::text) <= 8000),
  -- The typed name, the waiver's version, and the time are stored together or not at all.
  add constraint patients_waiver_complete check (
    (waiver_name is null) = (waiver_version is null) and (waiver_name is null) = (waiver_at is null)
  ),
  -- "Delete patient" anonymizes (core spec 12): an anonymized patient keeps none of the form.
  add constraint patients_anonymized_clean check (
    anonymized_at is null or num_nonnulls(
      middle_name, sex, address, occupation, email, guardian_name, hmo_number, previous_dentist, last_visit,
      visit_reason, emergency_name, emergency_mobile, waiver_name, waiver_version, waiver_at, medical
    ) = 0
  );

-- 5. Onboarding also creates the first branch, "Main", from the clinic's address, and puts the dentist's hours on it
-- (spec 4). The rest is 20260926000100_teams.sql unchanged.
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
  v_branch uuid;
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

  insert into public.branches (clinic_id, name, sms_name, address)
  values (v_clinic, 'Main', 'Main', coalesce(p->>'address', ''))
  returning id into v_branch;

  insert into public.working_hours (clinic_id, dentist_id, branch_id, weekday, start_time, end_time)
  select v_clinic, v_dentist, v_branch, (h->>'weekday')::smallint, (h->>'start')::time, (h->>'end')::time
  from jsonb_array_elements(p->'hours') h;

  insert into public.procedures (clinic_id, name, duration_minutes)
  select v_clinic, x->>'name', (x->>'minutes')::int
  from jsonb_array_elements(p->'procedures') x;

  return v_clinic;
end;
$$;
revoke execute on function public.create_clinic(jsonb) from public, anon;
grant execute on function public.create_clinic(jsonb) to authenticated;

-- 6. create_booking gains the branch and, for a new patient, the form (spec 4, 6). A caller that names no branch (the
-- staff New appointment and, until plan 8, the booking page) books at the clinic's first active branch, so the old
-- call shape keeps working. A new patient is matched by clinic, mobile, and name in one statement (patients_identity),
-- so two requests at once can no longer both insert them; a match keeps the form it has and only fills what it lacks.
-- BSBRA: no such active branch at this clinic.
drop function public.create_booking(
  uuid, uuid, timestamptz, timestamptz, text[], text, text, text, uuid, text, text, text, date, text, boolean, text, uuid
);
create function public.create_booking(
  p_clinic_id uuid,
  p_dentist_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_procedure_names text[],
  p_source text,
  p_status text,
  p_manage_token text,
  p_patient_id uuid,
  p_first_name text,
  p_last_name text,
  p_mobile text,
  p_birthday date,
  p_hmo text,
  p_consent boolean,
  p_actor text,
  p_user_id uuid,
  p_branch_id uuid default null,
  p_form jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_branch uuid;
  v_patient uuid := p_patient_id;
  v_id uuid;
begin
  select b.id into v_branch from public.branches b
  where b.clinic_id = p_clinic_id and b.active and (p_branch_id is null or b.id = p_branch_id)
  order by b.sort, b.created_at, b.id
  limit 1;
  if v_branch is null then
    raise exception 'branch not found' using errcode = 'BSBRA';
  end if;

  if v_patient is not null then
    perform 1 from public.patients
    where id = v_patient and clinic_id = p_clinic_id and anonymized_at is null;
    if not found then
      raise exception 'patient not found' using errcode = 'P0002';
    end if;
  else
    insert into public.patients as x (
      clinic_id, first_name, last_name, mobile, birthday, hmo, consent_at,
      middle_name, sex, address, occupation, email, guardian_name, hmo_number, previous_dentist, last_visit,
      visit_reason, emergency_name, emergency_mobile, waiver_name, waiver_version, waiver_at, medical
    )
    values (
      p_clinic_id, p_first_name, p_last_name, p_mobile, p_birthday, nullif(p_hmo, ''),
      case when p_consent then now() end,
      p_form->>'middle_name', p_form->>'sex', p_form->>'address', p_form->>'occupation', p_form->>'email',
      p_form->>'guardian_name', p_form->>'hmo_number', p_form->>'previous_dentist', p_form->>'last_visit',
      p_form->>'visit_reason', p_form->>'emergency_name', p_form->>'emergency_mobile',
      p_form->>'waiver_name', p_form->>'waiver_version', case when p_form->>'waiver_name' is not null then now() end,
      nullif(p_form->'medical', 'null'::jsonb)
    )
    on conflict (clinic_id, mobile, lower(first_name), lower(last_name)) where anonymized_at is null
    do update set
      birthday = coalesce(excluded.birthday, x.birthday),
      hmo = coalesce(excluded.hmo, x.hmo),
      consent_at = coalesce(excluded.consent_at, x.consent_at),
      middle_name = coalesce(x.middle_name, excluded.middle_name),
      sex = coalesce(x.sex, excluded.sex),
      address = coalesce(x.address, excluded.address),
      occupation = coalesce(x.occupation, excluded.occupation),
      email = coalesce(x.email, excluded.email),
      guardian_name = coalesce(x.guardian_name, excluded.guardian_name),
      hmo_number = coalesce(x.hmo_number, excluded.hmo_number),
      previous_dentist = coalesce(x.previous_dentist, excluded.previous_dentist),
      last_visit = coalesce(x.last_visit, excluded.last_visit),
      visit_reason = coalesce(x.visit_reason, excluded.visit_reason),
      emergency_name = coalesce(x.emergency_name, excluded.emergency_name),
      emergency_mobile = coalesce(x.emergency_mobile, excluded.emergency_mobile),
      waiver_name = coalesce(x.waiver_name, excluded.waiver_name),
      waiver_version = case when x.waiver_name is null then excluded.waiver_version else x.waiver_version end,
      waiver_at = case when x.waiver_name is null then excluded.waiver_at else x.waiver_at end,
      medical = coalesce(x.medical, excluded.medical)
    returning id into v_patient;
  end if;

  insert into public.appointments
    (clinic_id, branch_id, dentist_id, patient_id, starts_at, ends_at, status, procedure_names, source, manage_token,
     confirmed_at)
  values
    (p_clinic_id, v_branch, p_dentist_id, v_patient, p_starts_at, p_ends_at, p_status, p_procedure_names, p_source,
     p_manage_token, case when p_status = 'confirmed' then now() end)
  returning id into v_id;

  insert into public.appointment_events (clinic_id, appointment_id, from_status, to_status, actor, user_id)
  values (p_clinic_id, v_id, null, p_status, p_actor, p_user_id);

  return v_id;
end;
$$;
revoke execute on function public.create_booking(
  uuid, uuid, timestamptz, timestamptz, text[], text, text, text, uuid, text, text, text, date, text, boolean, text, uuid,
  uuid, jsonb
) from public, anon;
grant execute on function public.create_booking(
  uuid, uuid, timestamptz, timestamptz, text[], text, text, text, uuid, text, text, text, date, text, boolean, text, uuid,
  uuid, jsonb
) to authenticated, service_role;

-- 7. A patient's own change to a booking (spec 5), called with the secret key after the server checked the verified
-- number and re-validated the new time like a new booking. The appointment must be this clinic's, pending or
-- confirmed, and start in the future, at least the clinic's minimum notice from now, and its patient must have the
-- verified number; so must the patient it moves to, or a new patient gets that number. One update moves the time,
-- dentist, services, and patient, so the old time frees as the new one is taken, and no_overlap refuses a clash. The
-- clinic approves it again: pending, with confirmed_at and reminder_sent_at cleared. False when the appointment cannot
-- be changed; P0002 when the patient cannot be used.
create function public.change_booking(
  p_clinic_id uuid,
  p_id uuid,
  p_mobile text,
  p_dentist_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_procedure_names text[],
  p_patient_id uuid,
  p_first_name text,
  p_last_name text,
  p_birthday date,
  p_hmo text,
  p_form jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_from text;
  v_patient uuid := p_patient_id;
begin
  -- Locks the appointment, so a second change or a staff action waits for this one and then sees it.
  select a.status into v_from
  from public.appointments a
  join public.clinics c on c.id = a.clinic_id
  join public.patients p on p.id = a.patient_id
  where a.id = p_id and a.clinic_id = p_clinic_id
    and p.mobile = p_mobile and p.anonymized_at is null
    and a.status in ('pending', 'confirmed')
    and a.starts_at > now()
    and a.starts_at >= now() + make_interval(mins => c.min_notice_minutes)
  for update of a;
  if not found then
    return false;
  end if;

  if v_patient is not null then
    perform 1 from public.patients
    where id = v_patient and clinic_id = p_clinic_id and mobile = p_mobile and anonymized_at is null;
    if not found then
      raise exception 'patient not found' using errcode = 'P0002';
    end if;
  else
    insert into public.patients as x (
      clinic_id, first_name, last_name, mobile, birthday, hmo, consent_at,
      middle_name, sex, address, occupation, email, guardian_name, hmo_number, previous_dentist, last_visit,
      visit_reason, emergency_name, emergency_mobile, waiver_name, waiver_version, waiver_at, medical
    )
    values (
      p_clinic_id, p_first_name, p_last_name, p_mobile, p_birthday, nullif(p_hmo, ''), now(),
      p_form->>'middle_name', p_form->>'sex', p_form->>'address', p_form->>'occupation', p_form->>'email',
      p_form->>'guardian_name', p_form->>'hmo_number', p_form->>'previous_dentist', p_form->>'last_visit',
      p_form->>'visit_reason', p_form->>'emergency_name', p_form->>'emergency_mobile',
      p_form->>'waiver_name', p_form->>'waiver_version', case when p_form->>'waiver_name' is not null then now() end,
      nullif(p_form->'medical', 'null'::jsonb)
    )
    on conflict (clinic_id, mobile, lower(first_name), lower(last_name)) where anonymized_at is null
    do update set
      birthday = coalesce(excluded.birthday, x.birthday),
      hmo = coalesce(excluded.hmo, x.hmo),
      consent_at = coalesce(excluded.consent_at, x.consent_at),
      middle_name = coalesce(x.middle_name, excluded.middle_name),
      sex = coalesce(x.sex, excluded.sex),
      address = coalesce(x.address, excluded.address),
      occupation = coalesce(x.occupation, excluded.occupation),
      email = coalesce(x.email, excluded.email),
      guardian_name = coalesce(x.guardian_name, excluded.guardian_name),
      hmo_number = coalesce(x.hmo_number, excluded.hmo_number),
      previous_dentist = coalesce(x.previous_dentist, excluded.previous_dentist),
      last_visit = coalesce(x.last_visit, excluded.last_visit),
      visit_reason = coalesce(x.visit_reason, excluded.visit_reason),
      emergency_name = coalesce(x.emergency_name, excluded.emergency_name),
      emergency_mobile = coalesce(x.emergency_mobile, excluded.emergency_mobile),
      waiver_name = coalesce(x.waiver_name, excluded.waiver_name),
      waiver_version = case when x.waiver_name is null then excluded.waiver_version else x.waiver_version end,
      waiver_at = case when x.waiver_name is null then excluded.waiver_at else x.waiver_at end,
      medical = coalesce(x.medical, excluded.medical)
    returning id into v_patient;
  end if;

  update public.appointments
  set dentist_id = p_dentist_id,
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      procedure_names = p_procedure_names,
      patient_id = v_patient,
      status = 'pending',
      confirmed_at = null,
      reminder_sent_at = null
  where id = p_id;

  insert into public.appointment_events (clinic_id, appointment_id, from_status, to_status, actor, reason)
  values (p_clinic_id, p_id, v_from, 'pending', 'patient', 'Changed by patient');
  return true;
end;
$$;
revoke execute on function public.change_booking(
  uuid, uuid, text, uuid, timestamptz, timestamptz, text[], uuid, text, text, date, text, jsonb
) from public, anon, authenticated;
grant execute on function public.change_booking(
  uuid, uuid, text, uuid, timestamptz, timestamptz, text[], uuid, text, text, date, text, jsonb
) to service_role;
