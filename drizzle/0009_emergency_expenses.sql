ALTER TABLE `movements` ADD `emergency` integer NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE `movements` ADD `emergency_settled` integer NOT NULL DEFAULT false;--> statement-breakpoint
CREATE TABLE `emergency_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`emergency_id` text NOT NULL REFERENCES `movements`(`id`) ON DELETE cascade,
	`from_account_id` text NOT NULL REFERENCES `accounts`(`id`) ON DELETE cascade,
	`to_account_id` text NOT NULL REFERENCES `accounts`(`id`) ON DELETE cascade,
	`amount` integer NOT NULL,
	`date` text NOT NULL,
	`transfer_id` text,
	`created_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_emergency_payments_emergency` ON `emergency_payments` (`emergency_id`);
