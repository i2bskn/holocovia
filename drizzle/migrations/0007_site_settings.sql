CREATE TABLE `site_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`top_page_id` text,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`top_page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "site_settings_singleton_check" CHECK("site_settings"."id" = 1)
);
