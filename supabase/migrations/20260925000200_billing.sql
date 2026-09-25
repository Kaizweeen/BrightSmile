-- Billing (billing spec section 6): each clinic's trial and paid-through dates, the payments that extend
-- them, and the functions that change them. Staff read their own clinic's rows and never write them: only
-- the server's secret key (service_role) writes billing, through record_payment and extend_trial.

create table public.clinic_billing (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  trial_ends_at timestamptz not null,
  paid_through timestamptz,
  -- The ends_at a heads-up was already sent for (billing spec 7.4).
  renewal_notice_for timestamptz,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  method text not null check (method in ('gcash', 'paymongo')),
  -- What was actually paid, so a price change never rewrites history.
  amount_centavos integer not null check (amount_centavos > 0),
  months integer not null check (months between 1 and 12),
  -- The GCash reference number, or the PayMongo checkout session id.
  reference text not null check (char_length(reference) between 1 and 100),
  -- Unique, so a webhook delivered twice can never record twice (null for GCash).
  provider_session_id text unique,
  -- The operator who recorded a GCash payment; null for PayMongo.
  recorded_by uuid references auth.users (id) on delete set null,
  paid_through_after timestamptz not null,
  paid_at timestamptz not null default now(),
  -- A PayMongo payment always carries its session id, so it can only ever be recorded once.
  check ((method = 'paymongo') = (provider_session_id is not null))
);
create index payments_clinic_time on public.payments (clinic_id, paid_at);

alter table public.clinic_billing enable row level security;
alter table public.payments enable row level security;

create policy "members read their billing" on public.clinic_billing
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

create policy "members read their payments" on public.payments
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

-- Explicit grants: Supabase's default privileges would otherwise give anon and authenticated everything
-- on new tables. Staff may only read; the secret key writes.
revoke all on public.clinic_billing, public.payments from public, anon, authenticated;
grant select on public.clinic_billing, public.payments to authenticated;
grant all on public.clinic_billing, public.payments to service_role;

-- Onboarding also starts the 14 day trial (billing spec 6). The rest is 20260922000200_access.sql unchanged.
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

  insert into public.clinic_billing (clinic_id, trial_ends_at) values (v_clinic, now() + interval '14 days');

  return v_clinic;
end;
$$;
revoke execute on function public.create_clinic(jsonb) from public, anon;
grant execute on function public.create_clinic(jsonb) to authenticated;

-- Clinics that signed up before billing existed get a fresh 14 day trial from today, so none pauses the
-- moment this migration runs. Safe to run again: it only adds rows that are missing.
insert into public.clinic_billing (clinic_id, trial_ends_at)
select id, now() + interval '14 days' from public.clinics
on conflict (clinic_id) do nothing;

-- Records one payment in one transaction (billing spec 6). A payment extends from the latest of
-- paid_through, trial_ends_at, and now, so paying during the trial keeps the trial days and paying after
-- a lapse starts today. A PayMongo session id already recorded changes nothing and answers 'duplicate';
-- the unique provider_session_id backs that up if two deliveries race.
create function public.record_payment(
  p_clinic_id uuid,
  p_method text,
  p_amount_centavos integer,
  p_months integer,
  p_reference text,
  p_session_id text,
  p_recorded_by uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_trial timestamptz;
  v_paid timestamptz;
  v_after timestamptz;
begin
  -- A clinic without a billing row (none should exist after the backfill) counts as a trial that ended at signup.
  insert into public.clinic_billing (clinic_id, trial_ends_at)
  select id, created_at from public.clinics where id = p_clinic_id
  on conflict (clinic_id) do nothing;

  select trial_ends_at, paid_through into v_trial, v_paid
  from public.clinic_billing
  where clinic_id = p_clinic_id
  for update;
  if not found then
    raise exception 'clinic not found' using errcode = 'P0002';
  end if;

  if p_session_id is not null and exists (select 1 from public.payments where provider_session_id = p_session_id) then
    return jsonb_build_object('status', 'duplicate', 'paid_through', v_paid);
  end if;

  -- Months are added on the Manila calendar, whatever the session time zone (greatest ignores a null paid_through).
  v_after := ((greatest(v_paid, v_trial, now()) at time zone 'Asia/Manila') + make_interval(months => p_months))
    at time zone 'Asia/Manila';

  update public.clinic_billing
  set paid_through = v_after, renewal_notice_for = null
  where clinic_id = p_clinic_id;

  insert into public.payments
    (clinic_id, method, amount_centavos, months, reference, provider_session_id, recorded_by, paid_through_after)
  values
    (p_clinic_id, p_method, p_amount_centavos, p_months, p_reference, p_session_id, p_recorded_by, v_after);

  return jsonb_build_object('status', 'ok', 'paid_through', v_after);
end;
$$;
revoke execute on function public.record_payment(uuid, text, integer, integer, text, text, uuid) from public, anon, authenticated;
grant execute on function public.record_payment(uuid, text, integer, integer, text, text, uuid) to service_role;

-- The operator extends a trial by some days, from the later of its end and now (billing spec 7.6).
create function public.extend_trial(p_clinic_id uuid, p_days integer)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_end timestamptz;
begin
  if p_days is null or p_days not between 1 and 365 then
    raise exception 'days must be between 1 and 365' using errcode = '22023';
  end if;

  insert into public.clinic_billing (clinic_id, trial_ends_at)
  select id, now() + make_interval(days => p_days) from public.clinics where id = p_clinic_id
  on conflict (clinic_id) do update
    set trial_ends_at = greatest(public.clinic_billing.trial_ends_at, now()) + make_interval(days => p_days)
  returning trial_ends_at into v_end;

  if v_end is null then
    raise exception 'clinic not found' using errcode = 'P0002';
  end if;
  return v_end;
end;
$$;
revoke execute on function public.extend_trial(uuid, integer) from public, anon, authenticated;
grant execute on function public.extend_trial(uuid, integer) to service_role;

-- The admin page's list (billing spec 7.6): one row per clinic with its dates, active dentists, credits of
-- texts sent since p_month_start, and its last payment. Aggregated here because the API returns at most
-- 1000 rows per request, which a month of texts soon passes.
create function public.admin_overview(p_month_start timestamptz)
returns table (
  id uuid,
  name text,
  slug text,
  created_at timestamptz,
  trial_ends_at timestamptz,
  paid_through timestamptz,
  active_dentists integer,
  credits integer,
  last_paid_at timestamptz,
  last_months integer,
  last_amount_centavos integer,
  last_method text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id, c.name, c.slug, c.created_at, b.trial_ends_at, b.paid_through,
    (select count(*)::int from public.dentists d where d.clinic_id = c.id and d.active),
    (select coalesce(sum(s.credits), 0)::int from public.sms_log s
      where s.clinic_id = c.id and s.status = 'sent' and s.created_at >= p_month_start),
    p.paid_at, p.months, p.amount_centavos, p.method
  from public.clinics c
  left join public.clinic_billing b on b.clinic_id = c.id
  left join lateral (
    select x.paid_at, x.months, x.amount_centavos, x.method from public.payments x
    where x.clinic_id = c.id order by x.paid_at desc limit 1
  ) p on true
  order by c.created_at desc;
$$;
revoke execute on function public.admin_overview(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_overview(timestamptz) to service_role;
