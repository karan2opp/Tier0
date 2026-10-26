CREATE TYPE "public"."ticket_status" AS ENUM('created', 'pickup_scheduled', 'picked_up', 'diagnosing', 'awaiting_parts', 'repairing', 'quality_check', 'ready_for_delivery', 'out_for_delivery', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."warranty_plan" AS ENUM('standard', 'extended', 'accidental_damage');--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"city" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_email_unique" UNIQUE("email"),
	CONSTRAINT "customers_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"brand" text NOT NULL,
	"model" text NOT NULL,
	"serial_number" text NOT NULL,
	"purchase_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_serial_number_unique" UNIQUE("serial_number")
);
--> statement-breakpoint
CREATE TABLE "repair_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"issue" text NOT NULL,
	"diagnosis" text,
	"status" "ticket_status" DEFAULT 'created' NOT NULL,
	"covered_by_warranty" boolean DEFAULT false NOT NULL,
	"estimated_cost_inr" integer,
	"pickup_window_start" timestamp with time zone,
	"pickup_window_end" timestamp with time zone,
	"estimated_ready_at" timestamp with time zone,
	"delivery_window_start" timestamp with time zone,
	"delivery_window_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repair_tickets_ticket_number_unique" UNIQUE("ticket_number")
);
--> statement-breakpoint
CREATE TABLE "ticket_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"status" "ticket_status" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warranties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"plan" "warranty_plan" NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"covers_accidental_damage" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_tickets" ADD CONSTRAINT "repair_tickets_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_tickets" ADD CONSTRAINT "repair_tickets_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_repair_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."repair_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devices_customer_idx" ON "devices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "repair_tickets_customer_idx" ON "repair_tickets" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "repair_tickets_device_idx" ON "repair_tickets" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "repair_tickets_status_idx" ON "repair_tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ticket_events_ticket_idx" ON "ticket_events" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "warranties_device_idx" ON "warranties" USING btree ("device_id");