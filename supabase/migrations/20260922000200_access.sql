-- Access rules (spec section 7, RLS). Explicit grants, so behavior doesn't depend on project defaults.

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- security definer so policies can read clinic_members without recursing through its own policy.
create function public.is_clinic_member(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinic_members m
    where m.clinic_id = cid and m.user_id = (select auth.uid())
  );
$$;
revoke execute on function public.is_clinic_member(uuid) from public, anon;
grant execute on function public.is_clinic_member(uuid) to authenticated;

create policy "members manage their clinic" on public.clinics
  for all to authenticated
  using (public.is_clinic_member(id)) with check (public.is_clinic_member(id));

create policy "users see their memberships" on public.clinic_members
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "members manage dentists" on public.dentists
  for all to authenticated
  using (public.is_clinic_member(clinic_id)) with check (public.is_clinic_member(clinic_id));

create policy "members manage working hours" on public.working_hours
  for all to authenticated
  using (public.is_clinic_member(clinic_id)) with check (public.is_clinic_member(clinic_id));

create policy "members manage time off" on public.time_off
  for all to authenticated
  using (public.is_clinic_member(clinic_id)) with check (public.is_clinic_member(clinic_id));

create policy "members manage procedures" on public.procedures
  for all to authenticated
  using (public.is_clinic_member(clinic_id)) with check (public.is_clinic_member(clinic_id));

create policy "members manage patients" on public.patients
  for all to authenticated
  using (public.is_clinic_member(clinic_id)) with check (public.is_clinic_member(clinic_id));

create policy "members manage appointments" on public.appointments
  for all to authenticated
  using (public.is_clinic_member(clinic_id)) with check (public.is_clinic_member(clinic_id));

create policy "members read events" on public.appointment_events
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

create policy "members add events" on public.appointment_events
  for insert to authenticated
  with check (public.is_clinic_member(clinic_id));

create policy "members read their texts" on public.sms_log
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

create policy "users manage their push subscriptions" on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()) and public.is_clinic_member(clinic_id))
  with check (user_id = (select auth.uid()) and public.is_clinic_member(clinic_id));

-- otp_requests has no policies: only the server's secret key can touch it.

-- Onboarding (spec section 5.4): one call creates the clinic, membership, first dentist,
-- hours, and procedures together. security definer because the clinic row can't pass RLS
-- before its membership exists.
create function public.create_clinic(p jsonb)
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

  insert into public.clinic_members (clinic_id, user_id) values (v_clinic, v_user);

  insert into public.dentists (clinic_id, name, sms_name)
  values (v_clinic, p->'dentist'->>'name', p->'dentist'->>'sms_name')
  returning id into v_dentist;

  insert into public.working_hours (clinic_id, dentist_id, weekday, start_time, end_time)
  select v_clinic, v_dentist, (h->>'weekday')::smallint, (h->>'start')::time, (h->>'end')::time
  from jsonb_array_elements(p->'hours') h;

  insert into public.procedures (clinic_id, name, duration_minutes)
  select v_clinic, x->>'name', (x->>'minutes')::int
  from jsonb_array_elements(p->'procedures') x;

  return v_clinic;
end;
$$;
revoke execute on function public.create_clinic(jsonb) from public, anon;
grant execute on function public.create_clinic(jsonb) to authenticated;
