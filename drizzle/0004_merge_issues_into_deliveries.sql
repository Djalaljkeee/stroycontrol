-- Раздел «Списания» объединён с приходом: приход вводится сразу на конструктив.
-- Кто видел или вёл списания, получает раздел прихода, ключ issues убирается.
UPDATE "roles" SET "view_sections" = array_append("view_sections", 'deliveries')
  WHERE 'issues' = ANY("view_sections") AND NOT 'deliveries' = ANY("view_sections");--> statement-breakpoint
UPDATE "roles" SET "write_sections" = array_append("write_sections", 'deliveries')
  WHERE 'issues' = ANY("write_sections") AND NOT 'deliveries' = ANY("write_sections");--> statement-breakpoint
UPDATE "roles" SET "home" = 'deliveries' WHERE "home" = 'issues';--> statement-breakpoint
UPDATE "roles" SET "view_sections" = array_remove("view_sections", 'issues'),
  "write_sections" = array_remove("write_sections", 'issues');
