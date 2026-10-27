CREATE TABLE "closings" (
	"id" serial PRIMARY KEY NOT NULL,
	"period" date NOT NULL,
	"structure_id" integer NOT NULL,
	"material_id" integer NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	"design_quantity" numeric(14, 4),
	"revision" text,
	"document" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"note" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"stage" text NOT NULL,
	"level_from" text,
	"level_to" text,
	"consumption_from_closings" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "baselines" ALTER COLUMN "structure_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "baselines" ADD COLUMN "tier_id" integer;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "structure_id" integer;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "tier_id" integer;--> statement-breakpoint
ALTER TABLE "structures" ADD COLUMN "tier_id" integer;--> statement-breakpoint
ALTER TABLE "closings" ADD CONSTRAINT "closings_structure_id_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."structures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closings" ADD CONSTRAINT "closings_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closings" ADD CONSTRAINT "closings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "closings_structure_idx" ON "closings" USING btree ("structure_id");--> statement-breakpoint
CREATE INDEX "closings_period_idx" ON "closings" USING btree ("period");--> statement-breakpoint
CREATE UNIQUE INDEX "tiers_code_key" ON "tiers" USING btree ("code");--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_tier_id_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_structure_id_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."structures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_tier_id_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."tiers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structures" ADD CONSTRAINT "structures_tier_id_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."tiers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "baselines_tier_key" ON "baselines" USING btree ("tier_id","material_id","source","revision") WHERE "baselines"."structure_id" is null;--> statement-breakpoint
CREATE INDEX "deliveries_structure_idx" ON "deliveries" USING btree ("structure_id");--> statement-breakpoint
CREATE INDEX "deliveries_tier_idx" ON "deliveries" USING btree ("tier_id");--> statement-breakpoint
CREATE INDEX "structures_tier_idx" ON "structures" USING btree ("tier_id");--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_target_check" CHECK ("baselines"."structure_id" is not null or "baselines"."tier_id" is not null);