CREATE TABLE "bill_counters" (
	"branch_id" uuid NOT NULL,
	"day" date NOT NULL,
	"last_seq" integer NOT NULL,
	CONSTRAINT "bill_counters_branch_id_day_pk" PRIMARY KEY("branch_id","day")
);
--> statement-breakpoint
ALTER TABLE "bill_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bill_lines" (
	"bill_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"name" text NOT NULL,
	"qty" integer NOT NULL,
	"unit_price" integer NOT NULL,
	"procedure_id" uuid,
	CONSTRAINT "bill_lines_bill_id_position_pk" PRIMARY KEY("bill_id","position"),
	CONSTRAINT "bill_lines_name" CHECK (char_length("bill_lines"."name") between 1 and 100),
	CONSTRAINT "bill_lines_qty" CHECK ("bill_lines"."qty" between 1 and 999),
	CONSTRAINT "bill_lines_unit_price" CHECK ("bill_lines"."unit_price" between 0 and 100000000)
);
--> statement-breakpoint
ALTER TABLE "bill_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_no" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid,
	"appointment_id" uuid,
	"day" date NOT NULL,
	"method" text NOT NULL,
	"total" integer NOT NULL,
	"tendered" integer,
	"change_due" integer,
	"reference" text,
	"status" text DEFAULT 'paid' NOT NULL,
	"issued_by" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"void_reason" text,
	"voided_by" uuid,
	"voided_at" timestamp with time zone,
	CONSTRAINT "bills_receipt_no_unique" UNIQUE("receipt_no"),
	CONSTRAINT "bills_method" CHECK ("bills"."method" in ('cash', 'qr')),
	CONSTRAINT "bills_status" CHECK ("bills"."status" in ('paid', 'void')),
	CONSTRAINT "bills_total" CHECK ("bills"."total" between 1 and 1000000000),
	CONSTRAINT "bills_cash_fields" CHECK (("bills"."method" = 'cash' and "bills"."tendered" is not null and "bills"."change_due" is not null and "bills"."tendered" >= "bills"."total" and "bills"."change_due" = "bills"."tendered" - "bills"."total")
        or ("bills"."method" = 'qr' and "bills"."tendered" is null and "bills"."change_due" is null)),
	CONSTRAINT "bills_reference" CHECK (char_length("bills"."reference") between 1 and 60),
	CONSTRAINT "bills_void_fields" CHECK (("bills"."status" = 'paid' and "bills"."void_reason" is null and "bills"."voided_by" is null and "bills"."voided_at" is null)
        or ("bills"."status" = 'void' and char_length("bills"."void_reason") between 1 and 200 and "bills"."voided_by" is not null and "bills"."voided_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "bills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cash_closes" (
	"branch_id" uuid NOT NULL,
	"day" date NOT NULL,
	"expected_cash" integer NOT NULL,
	"expected_qr" integer NOT NULL,
	"counted_cash" integer NOT NULL,
	"closed_by" uuid NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_closes_branch_id_day_pk" PRIMARY KEY("branch_id","day"),
	CONSTRAINT "cash_closes_amounts" CHECK ("cash_closes"."expected_cash" >= 0 and "cash_closes"."expected_qr" >= 0 and "cash_closes"."counted_cash" between 0 and 1000000000)
);
--> statement-breakpoint
ALTER TABLE "cash_closes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "practice" ADD COLUMN "qr_image" text;--> statement-breakpoint
ALTER TABLE "procedures" ADD COLUMN "price" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bill_counters" ADD CONSTRAINT "bill_counters_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_procedure_id_procedures_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_closes" ADD CONSTRAINT "cash_closes_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_closes" ADD CONSTRAINT "cash_closes_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bills_branch_day" ON "bills" USING btree ("branch_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "bills_one_paid_per_visit" ON "bills" USING btree ("appointment_id") WHERE "bills"."status" = 'paid' and "bills"."appointment_id" is not null;--> statement-breakpoint
ALTER TABLE "practice" ADD CONSTRAINT "practice_qr_image" CHECK ("practice"."qr_image" is null or ("practice"."qr_image" ~ '^data:image/(png|jpeg)\x3bbase64,[A-Za-z0-9+/=]+$' and char_length("practice"."qr_image") <= 270000));--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_price" CHECK ("procedures"."price" between 0 and 100000000);