CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" integer,
	"payload" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "baselines" (
	"id" serial PRIMARY KEY NOT NULL,
	"structure_id" integer NOT NULL,
	"material_id" integer NOT NULL,
	"source" text NOT NULL,
	"revision" text NOT NULL,
	"design_quantity" numeric(14, 4),
	"purchase_quantity" numeric(14, 4),
	"effective_from" date NOT NULL,
	"note" text,
	CONSTRAINT "baselines_source_check" CHECK ("baselines"."source" in ('estimate','contract','project'))
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"material_id" integer NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	"pour_id" integer,
	"ttn_number" text,
	"supplier" text,
	"unit_price" numeric(16, 2),
	"needs_allocation" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"note" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"material_id" integer NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	"structure_id" integer NOT NULL,
	"pour_id" integer,
	"document" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"note" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"unit" text NOT NULL,
	"concrete_class" text,
	"rebar_diameter" integer,
	"rebar_class" text,
	"is_aggregate" boolean DEFAULT false NOT NULL,
	"aggregate_id" integer,
	CONSTRAINT "materials_kind_check" CHECK ("materials"."kind" in ('concrete','rebar'))
);
--> statement-breakpoint
CREATE TABLE "norms" (
	"id" serial PRIMARY KEY NOT NULL,
	"material_kind" text NOT NULL,
	"structure_kind" text,
	"structure_id" integer,
	"k_loss" numeric(6, 4) NOT NULL,
	"source" text NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "pours" (
	"id" serial PRIMARY KEY NOT NULL,
	"structure_id" integer NOT NULL,
	"label" text NOT NULL,
	"poured_at" date NOT NULL,
	"design_volume_m3" numeric(14, 4) NOT NULL,
	"concrete_material_id" integer NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"note" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pours_status_check" CHECK ("pours"."status" in ('planned','in_progress','done'))
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"material_id" integer NOT NULL,
	"layer" text NOT NULL,
	"value" numeric(16, 2) NOT NULL,
	"revision" text NOT NULL,
	CONSTRAINT "prices_layer_check" CHECK ("prices"."layer" in ('cost','contract'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "structures" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"level" text,
	"estimate_share" numeric(6, 4),
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"login" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_check" CHECK ("users"."role" in ('foreman','supply','estimator','viewer'))
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_structure_id_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."structures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_pour_id_pours_id_fk" FOREIGN KEY ("pour_id") REFERENCES "public"."pours"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_structure_id_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."structures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_pour_id_pours_id_fk" FOREIGN KEY ("pour_id") REFERENCES "public"."pours"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_aggregate_id_materials_id_fk" FOREIGN KEY ("aggregate_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "norms" ADD CONSTRAINT "norms_structure_id_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."structures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pours" ADD CONSTRAINT "pours_structure_id_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."structures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pours" ADD CONSTRAINT "pours_concrete_material_id_materials_id_fk" FOREIGN KEY ("concrete_material_id") REFERENCES "public"."materials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pours" ADD CONSTRAINT "pours_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structures" ADD CONSTRAINT "structures_parent_id_structures_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."structures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "baselines_key" ON "baselines" USING btree ("structure_id","material_id","source","revision");--> statement-breakpoint
CREATE INDEX "deliveries_material_date_idx" ON "deliveries" USING btree ("material_id","date");--> statement-breakpoint
CREATE INDEX "deliveries_pour_idx" ON "deliveries" USING btree ("pour_id");--> statement-breakpoint
CREATE INDEX "issues_material_date_idx" ON "issues" USING btree ("material_id","date");--> statement-breakpoint
CREATE INDEX "issues_structure_idx" ON "issues" USING btree ("structure_id");--> statement-breakpoint
CREATE UNIQUE INDEX "materials_code_key" ON "materials" USING btree ("code");--> statement-breakpoint
CREATE INDEX "pours_structure_idx" ON "pours" USING btree ("structure_id");--> statement-breakpoint
CREATE INDEX "pours_date_idx" ON "pours" USING btree ("poured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prices_material_layer_revision_key" ON "prices" USING btree ("material_id","layer","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "structures_code_key" ON "structures" USING btree ("code");--> statement-breakpoint
CREATE INDEX "structures_parent_idx" ON "structures" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_login_key" ON "users" USING btree ("login");