-- Hardening pass from the final code review. Composite FKs on events and texts, no anon
-- privileges of any kind (now or later), one clinic per account enforced by a unique index,
-- patient matching only merges on a real mobile, clinics are not deletable or insertable by
-- staff, reserved slugs enforced in the database, and otp_requests locked down further.

-- 1. Composite FKs for events and texts (spec 7): rows can never attach to another clinic's rows.
alter table public.appointments add constraint appointments_id_clinic_id_key unique (id, clinic_id);

alter table public.appointment_events drop constraint if exists appointment_events_appointment_id_fkey;
alter table public.appointment_events
  add foreign key (appointment_id, clinic_id) references public.appointments (id, clinic_id) on delete cascade;

alter table public.sms_log drop constraint if exists sms_log_appointment_id_fkey;
alter table public.sms_log
  add foreign key (appointment_id, clinic_id) references public.appointments (id, clinic_id) on delete set null (appointment_id);
alter table public.sms_log add constraint sms_log_appointment_clinic_check
  check (appointment_id is null or clinic_id is not null);

-- 2. Anon gets nothing, now and for future objects.
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
revoke execute on all functions in schema public from anon, public;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon, public;

-- 3. One clinic per account: close the race the application check alone could miss.
drop index public.clinic_members_user;
create unique index clinic_members_one_user on public.clinic_members (user_id);

-- 4. Null-mobile patient merge: only match an existing patient when a mobile was given.
create or replace function public.create_booking(
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
  p_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_patient uuid := p_patient_id;
  v_id uuid;
begin
  if v_patient is not null then
    perform 1 from public.patients
    where id = v_patient and clinic_id = p_clinic_id and anonymized_at is null;
    if not found then
      raise exception 'patient not found' using errcode = 'P0002';
    end if;
  else
    select id into v_patient from public.patients
    where clinic_id = p_clinic_id
      and anonymized_at is null
      and p_mobile is not null and mobile = p_mobile
      and lower(first_name) = lower(p_first_name)
      and lower(last_name) = lower(p_last_name)
    limit 1;

    if v_patient is null then
      insert into public.patients (clinic_id, first_name, last_name, mobile, birthday, hmo, consent_at)
      values (p_clinic_id, p_first_name, p_last_name, p_mobile, p_birthday, nullif(p_hmo, ''),
              case when p_consent then now() end)
      returning id into v_patient;
    else
      update public.patients
      set birthday = coalesce(p_birthday, birthday),
          hmo = coalesce(nullif(p_hmo, ''), hmo),
          consent_at = case when p_consent then now() else consent_at end
      where id = v_patient;
    end if;
  end if;

  insert into public.appointments
    (clinic_id, dentist_id, patient_id, starts_at, ends_at, status, procedure_names, source, manage_token, confirmed_at)
  values
    (p_clinic_id, p_dentist_id, v_patient, p_starts_at, p_ends_at, p_status, p_procedure_names, p_source, p_manage_token,
     case when p_status = 'confirmed' then now() end)
  returning id into v_id;

  insert into public.appointment_events (clinic_id, appointment_id, from_status, to_status, actor, user_id)
  values (p_clinic_id, v_id, null, p_status, p_actor, p_user_id);

  return v_id;
end;
$$;
revoke execute on function public.create_booking(uuid, uuid, timestamptz, timestamptz, text[], text, text, text, uuid, text, text, text, date, text, boolean, text, uuid) from public, anon;
grant execute on function public.create_booking(uuid, uuid, timestamptz, timestamptz, text[], text, text, text, uuid, text, text, text, date, text, boolean, text, uuid) to authenticated, service_role;

-- 5. Clinics are not deletable or insertable by staff (spec 12: clinic deletion is manual).
drop policy "members manage their clinic" on public.clinics;
create policy "members view their clinic" on public.clinics
  for select to authenticated
  using (public.is_clinic_member(id));
create policy "members update their clinic" on public.clinics
  for update to authenticated
  using (public.is_clinic_member(id)) with check (public.is_clinic_member(id));
revoke insert, delete on public.clinics from authenticated;

-- 6. Reserved slugs enforced in the database too (must match src/lib/validate.ts RESERVED_SLUGS).
alter table public.clinics add constraint clinics_slug_not_reserved check (
  slug not in ('a', 'app', 'api', 'auth', 'login', 'signup', 'onboarding', 'forgot',
               'reset-password', 'privacy', 'terms', 'admin', 'static', '_next')
);

-- 7. Defense in depth: otp_requests already has RLS with no policies; also strip the base grant.
revoke all on public.otp_requests from authenticated;
