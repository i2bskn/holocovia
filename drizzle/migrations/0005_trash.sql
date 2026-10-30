ALTER TABLE `pages` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `pages` ADD `deleted_by` text;--> statement-breakpoint
CREATE INDEX `pages_deleted_at_idx` ON `pages` (`deleted_at`);