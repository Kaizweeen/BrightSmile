CREATE TABLE "procedure_dentists" (
	"procedure_id" uuid NOT NULL,
	"dentist_id" uuid NOT NULL,
	CONSTRAINT "procedure_dentists_procedure_id_dentist_id_pk" PRIMARY KEY("procedure_id","dentist_id")
);
--> statement-breakpoint
ALTER TABLE "procedure_dentists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "practice" ADD COLUMN "visit_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "practice" ADD COLUMN "cleaning_minutes" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "practice" ADD COLUMN "online_booking" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "practice" ADD COLUMN "privacy_notice" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "procedures" ADD COLUMN "online" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "procedure_dentists" ADD CONSTRAINT "procedure_dentists_procedure_id_procedures_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_dentists" ADD CONSTRAINT "procedure_dentists_dentist_id_users_id_fk" FOREIGN KEY ("dentist_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice" ADD CONSTRAINT "practice_visit_minutes" CHECK ("practice"."visit_minutes" between 15 and 240 and "practice"."visit_minutes" % 15 = 0);--> statement-breakpoint
ALTER TABLE "practice" ADD CONSTRAINT "practice_cleaning_minutes" CHECK ("practice"."cleaning_minutes" between 0 and 60 and "practice"."cleaning_minutes" % 5 = 0);--> statement-breakpoint
ALTER TABLE "practice" ADD CONSTRAINT "practice_privacy_notice" CHECK (char_length("practice"."privacy_notice") <= 5000);