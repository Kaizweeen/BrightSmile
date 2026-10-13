CREATE TABLE "patient_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"category" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_files_name" CHECK (char_length("patient_files"."name") between 1 and 120),
	CONSTRAINT "patient_files_content_type" CHECK ("patient_files"."content_type" in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "patient_files_size" CHECK ("patient_files"."size" between 1 and 4194304 and "patient_files"."size" = octet_length("patient_files"."data")),
	CONSTRAINT "patient_files_category" CHECK ("patient_files"."category" in ('xray', 'photo', 'consent', 'id', 'lab', 'referral', 'other')),
	CONSTRAINT "patient_files_description" CHECK (char_length("patient_files"."description") <= 200)
);
--> statement-breakpoint
ALTER TABLE "patient_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "patient_files" ADD CONSTRAINT "patient_files_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_files" ADD CONSTRAINT "patient_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patient_files_patient" ON "patient_files" USING btree ("patient_id","created_at");