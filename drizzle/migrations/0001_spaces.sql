CREATE TABLE `spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text,
	`owner_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "spaces_kind_check" CHECK("spaces"."kind" IN ('everyone', 'admin', 'personal')),
	CONSTRAINT "spaces_personal_check" CHECK(("spaces"."kind" = 'personal') = ("spaces"."owner_user_id" IS NOT NULL) AND ("spaces"."kind" = 'personal') = ("spaces"."name" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `spaces_owner_user_id_unique` ON `spaces` (`owner_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `spaces_name_unique` ON `spaces` (`name`);--> statement-breakpoint
-- Backfill: a personal space for every existing user. id is a UUID v4 like crypto.randomUUID().
INSERT INTO spaces (id, kind, name, owner_user_id, created_at, updated_at)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-'
    || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
  'personal', NULL, u.id, u.created_at, u.created_at
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM spaces s WHERE s.owner_user_id = u.id);
