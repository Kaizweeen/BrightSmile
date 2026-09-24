-- BrightSmile core schema (spec section 7). All times are timestamptz.

create extension if not exists btree_gist with schema extensions;

create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  sms_name text not null check (char_length(sms_name) between 1 and 20 and sms_name !~* '^test'),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$'),
  mobile text not null check (mobile ~ '^\+639[0-9]{9}$'),
  address text not null default '' check (char_length(address) <= 200),
  maps_url text check (maps_url ~ '^https://'),
  slot_minutes int not null default 30 check (slot_minutes in (15, 30, 60)),
  min_notice_minutes int not null default 120 check (min_notice_minutes between 0 and 10080),
  max_days_ahead int not null default 60 check (max_days_ahead between 1 and 365),
  alert_channel text not null default 'push' check (alert_channel in ('push', 'sms')),
  created_at timestamptz not null default now()
);

create table public.clinic_members (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role = 'owner'),
  created_at timestamptz not null default now(),
  primary key (clinic_id, user_id)
);
create index clinic_members_user on public.clinic_members (user_id);

create table public.dentists (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  sms_name text not null check (char_length(sms_name) between 1 and 16),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, clinic_id)
);

-- Composite foreign keys keep every row inside its own clinic.
create table public.working_hours (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  dentist_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (start_time < end_time),
  foreign key (dentist_id, clinic_id) references public.dentists (id, clinic_id) on delete cascade
);

create table public.time_off (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  dentist_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text not null default '' check (char_length(note) <= 100),
  check (starts_at < ends_at),
  foreign key (dentist_id, clinic_id) references public.dentists (id, clinic_id) on delete cascade
);
create index time_off_dentist_time on public.time_off (dentist_id, starts_at);

create table public.procedures (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  duration_minutes int not null check (duration_minutes between 5 and 480),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  first_name text not null check (char_length(first_name) between 1 and 50),
  last_name text not null check (char_length(last_name) between 1 and 50),
  mobile text check (mobile ~ '^\+639[0-9]{9}$'),
  birthday date check (birthday >= '1900-01-01'),
  hmo text check (char_length(hmo) <= 60),
  consent_at timestamptz,
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, clinic_id)
);
-- One patient per clinic, mobile, and name, so a parent can book several children with one number.
create unique index patients_identity
  on public.patients (clinic_id, mobile, lower(first_name), lower(last_name))
  where anonymized_at is null;

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  dentist_id uuid not null,
  patient_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null check (status in ('pending', 'confirmed', 'declined', 'cancelled', 'completed', 'no_show', 'expired')),
  procedure_names text[] not null check (cardinality(procedure_names) between 1 and 20),
  source text not null check (source in ('online', 'manual')),
  status_reason text check (char_length(status_reason) <= 36),
  manage_token text not null unique check (manage_token ~ '^[A-Za-z0-9]{12}$'),
  confirmed_at timestamptz,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  check (starts_at < ends_at),
  foreign key (dentist_id, clinic_id) references public.dentists (id, clinic_id),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  -- Spec section 7: a dentist can never have two overlapping pending or confirmed appointments.
  constraint no_overlap exclude using gist (
    dentist_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('pending', 'confirmed'))
);
create index appointments_clinic_time on public.appointments (clinic_id, starts_at);
create index appointments_patient on public.appointments (patient_id);

create table public.appointment_events (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  from_status text,
  to_status text not null,
  actor text not null check (actor in ('patient', 'staff', 'system')),
  user_id uuid references auth.users (id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);
create index appointment_events_appointment on public.appointment_events (appointment_id);

create table public.sms_log (
  id bigint generated always as identity primary key,
  clinic_id uuid references public.clinics (id) on delete cascade,
  appointment_id uuid references public.appointments (id) on delete set null,
  to_mobile text not null,
  kind text not null,
  body text,
  credits int not null,
  status text not null check (status in ('logged', 'sent', 'failed')),
  provider_message_id text,
  error text,
  created_at timestamptz not null default now()
);
create index sms_log_appointment on public.sms_log (appointment_id);
create index sms_log_clinic_time on public.sms_log (clinic_id, created_at);

-- id is generated by the server before hashing, because the code hash is bound to it.
create table public.otp_requests (
  id uuid primary key,
  mobile text not null,
  ip text not null,
  code_hash text not null,
  booking jsonb not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index otp_requests_mobile_time on public.otp_requests (mobile, created_at);
create index otp_requests_ip_time on public.otp_requests (ip, created_at);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- Locked by default. Task 11 adds the access rules.
alter table public.clinics enable row level security;
alter table public.clinic_members enable row level security;
alter table public.dentists enable row level security;
alter table public.working_hours enable row level security;
alter table public.time_off enable row level security;
alter table public.procedures enable row level security;
alter table public.patients enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_events enable row level security;
alter table public.sms_log enable row level security;
alter table public.otp_requests enable row level security;
alter table public.push_subscriptions enable row level security;
