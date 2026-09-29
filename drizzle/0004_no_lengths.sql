ALTER TABLE "procedures" DROP CONSTRAINT "procedures_duration";--> statement-breakpoint
ALTER TABLE "procedures" DROP CONSTRAINT "procedures_buffer";--> statement-breakpoint
ALTER TABLE "appointment_procedures" DROP COLUMN "duration_minutes";--> statement-breakpoint
ALTER TABLE "appointment_procedures" DROP COLUMN "buffer_minutes";--> statement-breakpoint
ALTER TABLE "procedures" DROP COLUMN "duration_minutes";--> statement-breakpoint
ALTER TABLE "procedures" DROP COLUMN "buffer_minutes";