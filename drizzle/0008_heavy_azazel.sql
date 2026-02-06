ALTER TABLE `movements` ADD `transfer_id` text;--> statement-breakpoint
ALTER TABLE `movements` ADD `transfer_pair_id` text;--> statement-breakpoint
CREATE INDEX `idx_movements_transfer` ON `movements` (`transfer_id`);