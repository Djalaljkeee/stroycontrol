CREATE TABLE "roles" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"view_sections" text[] DEFAULT '{}'::text[] NOT NULL,
	"write_sections" text[] DEFAULT '{}'::text[] NOT NULL,
	"home" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL
);
--> statement-breakpoint
INSERT INTO "roles" ("code","name","description","view_sections","write_sections","home","is_system","sort_order") VALUES
 ('admin','Администратор','всё, включая учётные записи и роли',
  '{control,dashboard,deliveries,pours,issues,tiers,closings,balance,structures,revisions,export,users}',
  '{deliveries,allocate,pours,issues,closings,baselines}','control',true,10),
 ('manager','Руководитель проекта','контроль защиты объёмов, сметы и прогноза; без ввода',
  '{control,dashboard,deliveries,pours,issues,tiers,closings,balance,structures,revisions,export}',
  '{}','control',true,20),
 ('estimator','Сметчик','процентовка, базы, любой ввод',
  '{control,dashboard,deliveries,pours,issues,tiers,closings,balance,structures,revisions,export}',
  '{deliveries,allocate,pours,issues,closings,baselines}','dashboard',true,30),
 ('foreman','Прораб','приход, разнесение по конструкциям, выполнение, акты монтажа',
  '{deliveries,pours,issues,tiers,balance}',
  '{deliveries,allocate,pours,issues}','deliveries',true,40),
 ('supply','Снабжение','приход по ТТН и склад',
  '{deliveries,tiers,balance,export}',
  '{deliveries}','deliveries',true,50),
 ('viewer','Наблюдатель','только просмотр',
  '{control,dashboard,deliveries,pours,issues,tiers,closings,balance,structures,revisions,export}',
  '{}','control',true,60)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_check";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_roles_code_fk" FOREIGN KEY ("role") REFERENCES "public"."roles"("code") ON DELETE restrict ON UPDATE cascade;