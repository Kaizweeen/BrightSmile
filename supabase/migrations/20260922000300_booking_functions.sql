-- Booking and status changes (spec sections 9.1 and 9.2). security invoker: RLS applies to
-- signed-in staff, while the server's secret key (service_role) bypasses it for online bookings.

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
      and mobile is not distinct from p_mobile
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

create function public.set_appointment_status(
  p_id uuid, p_from text, p_to text, p_actor text, p_user_id uuid, p_reason text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_clinic uuid;
begin
  update public.appointments
  set status = p_to,
      status_reason = coalesce(nullif(p_reason, ''), status_reason),
      confirmed_at = case when p_to = 'confirmed' then now() else confirmed_at end
  where id = p_id and status = p_from
  returning clinic_id into v_clinic;

  if v_clinic is null then
    return false;
  end if;

  insert into public.appointment_events (clinic_id, appointment_id, from_status, to_status, actor, user_id, reason)
  values (v_clinic, p_id, p_from, p_to, p_actor, p_user_id, nullif(p_reason, ''));
  return true;
end;
$$;
revoke execute on function public.set_appointment_status(uuid, text, text, text, uuid, text) from public, anon;
grant execute on function public.set_appointment_status(uuid, text, text, text, uuid, text) to authenticated, service_role;

create function public.move_appointment(
  p_id uuid, p_dentist_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_user_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_clinic uuid;
begin
  update public.appointments
  set dentist_id = p_dentist_id,
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      confirmed_at = now(),
      reminder_sent_at = null
  where id = p_id and status = 'confirmed'
  returning clinic_id into v_clinic;

  if v_clinic is null then
    return false;
  end if;

  insert into public.appointment_events (clinic_id, appointment_id, from_status, to_status, actor, user_id, reason)
  values (v_clinic, p_id, 'confirmed', 'confirmed', 'staff', p_user_id, 'moved');
  return true;
end;
$$;
revoke execute on function public.move_appointment(uuid, uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.move_appointment(uuid, uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;

create function public.expire_pending()
returns integer
language sql
security invoker
set search_path = ''
as $$
  with expired as (
    update public.appointments
    set status = 'expired'
    where status = 'pending' and starts_at < now()
    returning id, clinic_id
  ), logged as (
    insert into public.appointment_events (clinic_id, appointment_id, from_status, to_status, actor)
    select clinic_id, id, 'pending', 'expired', 'system' from expired
    returning 1
  )
  select count(*)::int from logged;
$$;
revoke execute on function public.expire_pending() from public, anon, authenticated;
grant execute on function public.expire_pending() to service_role;
