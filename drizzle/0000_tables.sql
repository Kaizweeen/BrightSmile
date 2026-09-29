CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointment_procedures" (
	"appointment_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"procedure_id" uuid NOT NULL,
	"name" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"buffer_minutes" integer NOT NULL,
	CONSTRAINT "appointment_procedures_appointment_id_position_pk" PRIMARY KEY("appointment_id","position")
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"dentist_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"chair_number" smallint NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"chair_free_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"cancel_reason" text,
	"confirmed_at" timestamp with time zone,
	"checked_in_at" timestamp with time zone,
	"treatment_started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_status" CHECK ("appointments"."status" in ('requested', 'confirmed', 'checked_in', 'in_treatment', 'completed', 'no_show', 'cancelled')),
	CONSTRAINT "appointments_source" CHECK ("appointments"."source" in ('staff', 'walk_in', 'portal')),
	CONSTRAINT "appointments_times" CHECK ("appointments"."start_time" < "appointments"."end_time" and "appointments"."end_time" <= "appointments"."chair_free_at"),
	CONSTRAINT "appointments_note" CHECK (char_length("appointments"."note") <= 500),
	CONSTRAINT "appointments_cancel_reason" CHECK (char_length("appointments"."cancel_reason") between 1 and 200),
	CONSTRAINT "appointments_cancelled_has_reason" CHECK ("appointments"."status" <> 'cancelled' or "appointments"."cancel_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"branch_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"operating_hours" jsonb NOT NULL,
	"join_code" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_code_unique" UNIQUE("code"),
	CONSTRAINT "branches_join_code_unique" UNIQUE("join_code"),
	CONSTRAINT "branches_code" CHECK ("branches"."code" ~ '^[a-z0-9][a-z0-9-]{0,22}[a-z0-9]$' and "branches"."code" <> 'all'),
	CONSTRAINT "branches_name" CHECK (char_length("branches"."name") between 1 and 40),
	CONSTRAINT "branches_address" CHECK (char_length("branches"."address") <= 200),
	CONSTRAINT "branches_phone" CHECK (char_length("branches"."phone") <= 20),
	CONSTRAINT "branches_hours" CHECK (jsonb_typeof("branches"."operating_hours") = 'object')
);
--> statement-breakpoint
CREATE TABLE "chairs" (
	"branch_id" uuid NOT NULL,
	"number" smallint NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chairs_branch_id_number_pk" PRIMARY KEY("branch_id","number"),
	CONSTRAINT "chairs_number" CHECK ("chairs"."number" between 1 and 99),
	CONSTRAINT "chairs_label" CHECK (char_length("chairs"."label") <= 30)
);
--> statement-breakpoint
CREATE TABLE "chart_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"branch_id" uuid,
	"tooth" smallint NOT NULL,
	"surfaces" text[] DEFAULT '{}'::text[] NOT NULL,
	"code" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	CONSTRAINT "chart_entries_tooth" CHECK ("chart_entries"."tooth" between 11 and 18 or "chart_entries"."tooth" between 21 and 28 or "chart_entries"."tooth" between 31 and 38
        or "chart_entries"."tooth" between 41 and 48 or "chart_entries"."tooth" between 51 and 55 or "chart_entries"."tooth" between 61 and 65
        or "chart_entries"."tooth" between 71 and 75 or "chart_entries"."tooth" between 81 and 85),
	CONSTRAINT "chart_entries_surfaces" CHECK ("chart_entries"."surfaces" <@ array['M', 'D', 'O', 'B', 'L']::text[]),
	CONSTRAINT "chart_entries_code" CHECK ("chart_entries"."code" in ('present', 'D', 'M', 'MO', 'Im', 'Sp', 'Rf', 'Un', 'Am', 'Co', 'JC', 'Ab', 'Att', 'P', 'In', 'Imp', 'S', 'Rm', 'X', 'XO')),
	CONSTRAINT "chart_entries_note" CHECK (char_length("chart_entries"."note") <= 300),
	CONSTRAINT "chart_entries_void_reason" CHECK (char_length("chart_entries"."void_reason") between 1 and 200),
	CONSTRAINT "chart_entries_void_complete" CHECK (("chart_entries"."voided_at" is null) = ("chart_entries"."voided_by" is null) and ("chart_entries"."voided_at" is null) = ("chart_entries"."void_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "dentist_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dentist_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"day_of_week" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dentist_schedules_day" CHECK ("dentist_schedules"."day_of_week" between 0 and 6),
	CONSTRAINT "dentist_schedules_order" CHECK ("dentist_schedules"."start_time" < "dentist_schedules"."end_time"),
	CONSTRAINT "dentist_schedules_grid" CHECK (extract(minute from "dentist_schedules"."start_time")::int % 15 = 0 and extract(minute from "dentist_schedules"."end_time")::int % 15 = 0
        and extract(second from "dentist_schedules"."start_time") = 0 and extract(second from "dentist_schedules"."end_time") = 0)
);
--> statement-breakpoint
CREATE TABLE "dentist_time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dentist_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dentist_time_off_order" CHECK ("dentist_time_off"."starts_at" < "dentist_time_off"."ends_at"),
	CONSTRAINT "dentist_time_off_reason" CHECK (char_length("dentist_time_off"."reason") <= 100)
);
--> statement-breakpoint
CREATE TABLE "exams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"findings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exams_appointment_id_unique" UNIQUE("appointment_id"),
	CONSTRAINT "exams_findings" CHECK (jsonb_typeof("exams"."findings") = 'object' and octet_length("exams"."findings"::text) <= 4000)
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chart_no" integer GENERATED ALWAYS AS IDENTITY (sequence name "patients_chart_no_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"last_name" text NOT NULL,
	"first_name" text NOT NULL,
	"middle_name" text,
	"birthday" date,
	"sex" text,
	"mobile" text,
	"email" text,
	"address" text,
	"occupation" text,
	"guardian_name" text,
	"emergency_name" text,
	"emergency_mobile" text,
	"hmo_provider" text,
	"hmo_member_no" text,
	"insurance_effective" date,
	"allergies" text[] DEFAULT '{}'::text[] NOT NULL,
	"allergies_other" text,
	"medical_alerts" text DEFAULT '' NOT NULL,
	"consent_at" timestamp with time zone,
	"consent_by" uuid,
	"home_branch_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "patients_chart_no_unique" UNIQUE("chart_no"),
	CONSTRAINT "patients_last_name" CHECK (char_length("patients"."last_name") between 1 and 50),
	CONSTRAINT "patients_first_name" CHECK (char_length("patients"."first_name") between 1 and 50),
	CONSTRAINT "patients_middle_name" CHECK (char_length("patients"."middle_name") between 1 and 50),
	CONSTRAINT "patients_birthday" CHECK ("patients"."birthday" >= '1900-01-01'),
	CONSTRAINT "patients_sex" CHECK ("patients"."sex" in ('female', 'male')),
	CONSTRAINT "patients_mobile" CHECK ("patients"."mobile" ~ '^\+639[0-9]{9}$'),
	CONSTRAINT "patients_emergency_mobile" CHECK ("patients"."emergency_mobile" ~ '^\+639[0-9]{9}$'),
	CONSTRAINT "patients_email" CHECK (char_length("patients"."email") <= 254 and "patients"."email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
	CONSTRAINT "patients_address" CHECK (char_length("patients"."address") between 1 and 200),
	CONSTRAINT "patients_occupation" CHECK (char_length("patients"."occupation") between 1 and 60),
	CONSTRAINT "patients_guardian" CHECK (char_length("patients"."guardian_name") between 1 and 100),
	CONSTRAINT "patients_emergency_name" CHECK (char_length("patients"."emergency_name") between 1 and 100),
	CONSTRAINT "patients_hmo_provider" CHECK (char_length("patients"."hmo_provider") between 1 and 60),
	CONSTRAINT "patients_hmo_member_no" CHECK (char_length("patients"."hmo_member_no") between 1 and 40),
	CONSTRAINT "patients_allergies" CHECK ("patients"."allergies" <@ array['local_anesthetic', 'penicillin', 'sulfa', 'aspirin', 'latex']::text[]),
	CONSTRAINT "patients_allergies_other" CHECK (char_length("patients"."allergies_other") between 1 and 100),
	CONSTRAINT "patients_medical_alerts" CHECK (char_length("patients"."medical_alerts") <= 500),
	CONSTRAINT "patients_consent" CHECK (("patients"."consent_at" is null) = ("patients"."consent_by" is null))
);
--> statement-breakpoint
CREATE TABLE "practice" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_one_row" CHECK ("practice"."id"),
	CONSTRAINT "practice_name" CHECK (char_length("practice"."name") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "procedures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"buffer_minutes" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procedures_name_unique" UNIQUE("name"),
	CONSTRAINT "procedures_name" CHECK (char_length("procedures"."name") between 1 and 60),
	CONSTRAINT "procedures_duration" CHECK ("procedures"."duration_minutes" between 5 and 480 and "procedures"."duration_minutes" % 5 = 0),
	CONSTRAINT "procedures_buffer" CHECK ("procedures"."buffer_minutes" between 0 and 120)
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "treatment_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"amends_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treatment_notes_body" CHECK (char_length("treatment_notes"."body") between 1 and 4000)
);
--> statement-breakpoint
CREATE TABLE "user_branches" (
	"user_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	CONSTRAINT "user_branches_user_id_branch_id_pk" PRIMARY KEY("user_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"username" text NOT NULL,
	"display_username" text,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"title" text,
	"sees_patients" boolean DEFAULT false NOT NULL,
	"primary_branch_id" uuid,
	"requested_branch_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_role" CHECK ("users"."role" in ('owner', 'manager', 'dentist')),
	CONSTRAINT "users_status" CHECK ("users"."status" in ('pending', 'active', 'disabled')),
	CONSTRAINT "users_name" CHECK (char_length("users"."name") between 2 and 80),
	CONSTRAINT "users_username" CHECK ("users"."username" ~ '^[a-z0-9._]{3,30}$'),
	CONSTRAINT "users_title" CHECK (char_length("users"."title") between 1 and 40),
	CONSTRAINT "users_dentists_see_patients" CHECK ("users"."role" <> 'dentist' or "users"."sees_patients"),
	CONSTRAINT "users_managers_do_not" CHECK ("users"."role" <> 'manager' or not "users"."sees_patients")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD CONSTRAINT "appointment_procedures_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD CONSTRAINT "appointment_procedures_procedure_id_procedures_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_dentist_id_users_id_fk" FOREIGN KEY ("dentist_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_branch_id_chair_number_chairs_branch_id_number_fk" FOREIGN KEY ("branch_id","chair_number") REFERENCES "public"."chairs"("branch_id","number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chairs" ADD CONSTRAINT "chairs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_entries" ADD CONSTRAINT "chart_entries_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_entries" ADD CONSTRAINT "chart_entries_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_entries" ADD CONSTRAINT "chart_entries_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_entries" ADD CONSTRAINT "chart_entries_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_entries" ADD CONSTRAINT "chart_entries_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dentist_schedules" ADD CONSTRAINT "dentist_schedules_dentist_id_users_id_fk" FOREIGN KEY ("dentist_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dentist_schedules" ADD CONSTRAINT "dentist_schedules_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dentist_time_off" ADD CONSTRAINT "dentist_time_off_dentist_id_users_id_fk" FOREIGN KEY ("dentist_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dentist_time_off" ADD CONSTRAINT "dentist_time_off_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_consent_by_users_id_fk" FOREIGN KEY ("consent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_home_branch_id_branches_id_fk" FOREIGN KEY ("home_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_notes" ADD CONSTRAINT "treatment_notes_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_notes" ADD CONSTRAINT "treatment_notes_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_notes" ADD CONSTRAINT "treatment_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_notes" ADD CONSTRAINT "treatment_notes_amends_id_treatment_notes_id_fk" FOREIGN KEY ("amends_id") REFERENCES "public"."treatment_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_primary_branch_id_branches_id_fk" FOREIGN KEY ("primary_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_requested_branch_id_branches_id_fk" FOREIGN KEY ("requested_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "appointments_branch_time" ON "appointments" USING btree ("branch_id","start_time");--> statement-breakpoint
CREATE INDEX "appointments_dentist_time" ON "appointments" USING btree ("dentist_id","start_time");--> statement-breakpoint
CREATE INDEX "appointments_patient_time" ON "appointments" USING btree ("patient_id","start_time");--> statement-breakpoint
CREATE INDEX "audit_log_entity" ON "audit_log" USING btree ("entity","entity_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_user" ON "audit_log" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_at" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "chart_entries_patient" ON "chart_entries" USING btree ("patient_id","tooth");--> statement-breakpoint
CREATE INDEX "dentist_schedules_dentist" ON "dentist_schedules" USING btree ("dentist_id","day_of_week");--> statement-breakpoint
CREATE INDEX "dentist_time_off_dentist" ON "dentist_time_off" USING btree ("dentist_id","starts_at");--> statement-breakpoint
CREATE INDEX "exams_patient" ON "exams" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "patients_last_name_lower" ON "patients" USING btree (lower("last_name"));--> statement-breakpoint
CREATE INDEX "patients_mobile" ON "patients" USING btree ("mobile");--> statement-breakpoint
CREATE INDEX "sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "treatment_notes_patient" ON "treatment_notes" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_one_owner" ON "users" USING btree ("role") WHERE "users"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "verifications_identifier" ON "verifications" USING btree ("identifier");