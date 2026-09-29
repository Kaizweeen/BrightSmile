CREATE TABLE "patient_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"last_name" text NOT NULL,
	"first_name" text NOT NULL,
	"middle_name" text,
	"birthday" date NOT NULL,
	"sex" text NOT NULL,
	"mobile" text NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_forms_last_name" CHECK (char_length("patient_forms"."last_name") between 1 and 50),
	CONSTRAINT "patient_forms_first_name" CHECK (char_length("patient_forms"."first_name") between 1 and 50),
	CONSTRAINT "patient_forms_middle_name" CHECK (char_length("patient_forms"."middle_name") between 1 and 50),
	CONSTRAINT "patient_forms_birthday" CHECK ("patient_forms"."birthday" >= '1900-01-01'),
	CONSTRAINT "patient_forms_sex" CHECK ("patient_forms"."sex" in ('female', 'male')),
	CONSTRAINT "patient_forms_mobile" CHECK ("patient_forms"."mobile" ~ '^\+639[0-9]{9}$'),
	CONSTRAINT "patient_forms_address" CHECK (char_length("patient_forms"."address") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "patient_forms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "practice" ADD COLUMN "patient_forms" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "patient_forms" ADD CONSTRAINT "patient_forms_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patient_forms_branch_created" ON "patient_forms" USING btree ("branch_id","created_at");