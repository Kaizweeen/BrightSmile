-- Billing rules Drizzle cannot express (billing spec, section 2). DS002 is DentaSync's "never edited" code (see 0001).
create function bills_void_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.status <> 'paid' or new.status <> 'void'
     or (new.id, new.receipt_no, new.branch_id, new.patient_id, new.appointment_id, new.day, new.method, new.total,
         new.tendered, new.change_due, new.reference, new.issued_by, new.issued_at)
        is distinct from
        (old.id, old.receipt_no, old.branch_id, old.patient_id, old.appointment_id, old.day, old.method, old.total,
         old.tendered, old.change_due, old.reference, old.issued_by, old.issued_at) then
    raise exception 'bills are only ever voided, once' using errcode = 'DS002';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger bills_void_only
  before update or delete on bills
  for each row execute function bills_void_only();
--> statement-breakpoint
create trigger bill_lines_never_edited
  before update or delete on bill_lines
  for each row execute function refuse_edit();
--> statement-breakpoint
create trigger cash_closes_never_edited
  before update or delete on cash_closes
  for each row execute function refuse_edit();
