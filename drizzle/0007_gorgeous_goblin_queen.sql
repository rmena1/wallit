ALTER TABLE `movements` ADD `receivable_id` text;--> statement-breakpoint
ALTER TABLE `movements` ADD `time` text;--> statement-breakpoint
ALTER TABLE `movements` ADD `original_name` text;--> statement-breakpoint
CREATE INDEX `idx_movements_review` ON `movements` (`user_id`,`needs_review`);