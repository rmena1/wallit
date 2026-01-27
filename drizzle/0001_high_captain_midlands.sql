CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`emoji` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_categories_user` ON `categories` (`user_id`);--> statement-breakpoint
ALTER TABLE `movements` ADD `category_id` text REFERENCES categories(id);--> statement-breakpoint
CREATE INDEX `idx_movements_category` ON `movements` (`category_id`);