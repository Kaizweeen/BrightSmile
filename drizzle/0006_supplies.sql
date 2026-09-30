CREATE TABLE "supplies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"reorder_level" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplies_name" CHECK (char_length("supplies"."name") between 1 and 60),
	CONSTRAINT "supplies_unit" CHECK (char_length("supplies"."unit") between 1 and 20),
	CONSTRAINT "supplies_quantity" CHECK ("supplies"."quantity" >= 0),
	CONSTRAINT "supplies_reorder_level" CHECK ("supplies"."reorder_level" >= 0)
);
--> statement-breakpoint
ALTER TABLE "supplies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplies" ADD CONSTRAINT "supplies_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplies_branch_name" ON "supplies" USING btree ("branch_id",lower("name"));