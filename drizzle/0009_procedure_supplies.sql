CREATE TABLE "procedure_supplies" (
	"procedure_id" uuid NOT NULL,
	"supply_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "procedure_supplies_procedure_id_supply_id_pk" PRIMARY KEY("procedure_id","supply_id"),
	CONSTRAINT "procedure_supplies_quantity" CHECK ("procedure_supplies"."quantity" between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "procedure_supplies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "procedure_supplies" ADD CONSTRAINT "procedure_supplies_procedure_id_procedures_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_supplies" ADD CONSTRAINT "procedure_supplies_supply_id_supplies_id_fk" FOREIGN KEY ("supply_id") REFERENCES "public"."supplies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "procedure_supplies_supply" ON "procedure_supplies" USING btree ("supply_id");