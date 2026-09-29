-- Rules Drizzle cannot express (spec section 7, "Enforced by the database"). Errors raised here use two
-- DentaSync codes: DS001 for a status change the lifecycle refuses, DS002 for editing a record that is never edited.
create extension if not exists btree_gist;
--> statement-breakpoint

-- 1 to 3. No overlapping active visits for a dentist (at any branch), a chair (visit plus turnover), or a patient.
alter table appointments add constraint appointments_dentist_no_overlap exclude using gist (
  dentist_id with =,
  tstzrange(start_time, end_time) with &&
) where (status in ('requested', 'confirmed', 'checked_in', 'in_treatment'));
--> statement-breakpoint
alter table appointments add constraint appointments_chair_no_overlap exclude using gist (
  branch_id with =,
  chair_number with =,
  tstzrange(start_time, chair_free_at) with &&
) where (status in ('requested', 'confirmed', 'checked_in', 'in_treatment'));
--> statement-breakpoint
alter table appointments add constraint appointments_patient_no_overlap exclude using gist (
  patient_id with =,
  tstzrange(start_time, end_time) with &&
) where (status in ('requested', 'confirmed', 'checked_in', 'in_treatment'));
--> statement-breakpoint

-- 4. A dentist's weekly blocks never overlap on a weekday, even at different branches (split days are allowed).
alter table dentist_schedules add constraint dentist_schedules_no_overlap exclude using gist (
  dentist_id with =,
  day_of_week with =,
  tsrange(date '2000-01-03' + start_time, date '2000-01-03' + end_time) with &&
);
--> statement-breakpoint

-- 5. The lifecycle (spec 8.6). Inserts start as requested, confirmed, or checked in; every other change must be one
-- of the listed pairs. The matching timestamp is stamped here so it can never disagree with the status.
create function appointments_status_flow() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('requested', 'confirmed', 'checked_in') then
      raise exception 'a visit starts as requested, confirmed, or checked in' using errcode = 'DS001';
    end if;
    if new.status in ('confirmed', 'checked_in') then
      new.confirmed_at := now();
    end if;
    if new.status = 'checked_in' then
      new.checked_in_at := now();
    end if;
    return new;
  end if;

  if new.status = old.status then
    return new;
  end if;
  if (old.status, new.status) not in (
    ('requested', 'confirmed'), ('requested', 'cancelled'),
    ('confirmed', 'checked_in'), ('confirmed', 'no_show'), ('confirmed', 'cancelled'),
    ('checked_in', 'in_treatment'), ('checked_in', 'cancelled'), ('checked_in', 'confirmed'),
    ('in_treatment', 'completed'),
    ('no_show', 'checked_in')
  ) then
    raise exception 'a visit cannot go from % to %', old.status, new.status using errcode = 'DS001';
  end if;

  if new.status = 'confirmed' and old.status = 'checked_in' then
    new.checked_in_at := null;
  elsif new.status = 'confirmed' then
    new.confirmed_at := now();
  elsif new.status = 'checked_in' then
    new.checked_in_at := now();
  elsif new.status = 'in_treatment' then
    new.treatment_started_at := now();
  elsif new.status = 'completed' then
    new.completed_at := now();
  elsif new.status = 'cancelled' then
    new.cancelled_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
--> statement-breakpoint
create trigger appointments_status_flow
  before insert or update of status on appointments
  for each row execute function appointments_status_flow();
--> statement-breakpoint

-- 7. Treatment notes and the audit log are never changed or deleted; a chart entry only ever gains its void columns,
-- once.
create function refuse_edit() returns trigger language plpgsql as $$
begin
  raise exception '% rows are never changed or deleted', tg_table_name using errcode = 'DS002';
end;
$$;
--> statement-breakpoint
create trigger treatment_notes_never_edited
  before update or delete on treatment_notes
  for each row execute function refuse_edit();
--> statement-breakpoint
create trigger audit_log_never_edited
  before update or delete on audit_log
  for each row execute function refuse_edit();
--> statement-breakpoint
create function chart_entries_void_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.voided_at is not null
     or (new.patient_id, new.appointment_id, new.branch_id, new.tooth, new.surfaces, new.code, new.note,
         new.author_id, new.created_at)
        is distinct from
        (old.patient_id, old.appointment_id, old.branch_id, old.tooth, old.surfaces, old.code, old.note,
         old.author_id, old.created_at) then
    raise exception 'chart entries are only ever voided, once' using errcode = 'DS002';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger chart_entries_void_only
  before update or delete on chart_entries
  for each row execute function chart_entries_void_only();
